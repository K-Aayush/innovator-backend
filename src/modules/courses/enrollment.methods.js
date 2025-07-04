const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const Enrollment = require("./enrollment.model");
const Course = require("./courses.model");
const User = require("../user/user.model");
const Notification = require("../notifications/notification.model");
const FCMHandler = require("../../utils/notification/fcmHandler");

// Enroll in course with free course handling
const EnrollInCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { paymentInfo, accessDuration } = req.body;
    const user = req.user;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    // Find the course
    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Check if course is published
    if (!course.isPublished) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Course not available" },
            "This course is not published"
          )
        );
    }

    // Check if user is already enrolled
    const existingEnrollment = await Enrollment.findOne({
      "student._id": user._id,
      "course._id": courseId,
    });

    if (existingEnrollment) {
      return res
        .status(409)
        .json(
          GenRes(
            409,
            existingEnrollment,
            { error: "Already enrolled" },
            "You are already enrolled in this course"
          )
        );
    }

    // Get user details
    const student = await User.findById(user._id).select(
      "_id email name picture phone"
    );

    // Check if course is free
    const isFree = !course.price?.usd || course.price.usd === 0;

    // Calculate access expiry date
    let expiryDate = null;
    if (accessDuration && !isFree) {
      expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + accessDuration);
    }

    // Create enrollment with appropriate payment info
    const enrollmentData = {
      student: student.toObject(),
      course: {
        _id: course._id.toString(),
        title: course.title,
        thumbnail: course.thumbnail,
        price: course.price,
        totalNotes: course.notes?.length || 0,
        category: course.category,
        author: course.author,
        isFree,
      },
      accessSettings: {
        expiryDate,
        maxDevices: 3,
        downloadAllowed: isFree || course.price?.usd === 0, // Free courses allow downloads
        offlineAccess: true,
      },
    };

    // Handle payment info based on course type
    if (isFree) {
      enrollmentData.paymentInfo = {
        amount: 0,
        currency: "USD",
        paymentMethod: "free",
        paymentDate: new Date(),
        paymentStatus: "completed",
        transactionId: `FREE_${Date.now()}`,
      };
    } else {
      // Validate payment info for paid courses
      if (!paymentInfo || !paymentInfo.amount || paymentInfo.amount <= 0) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "Payment required" },
              "Payment information required for paid courses"
            )
          );
      }

      enrollmentData.paymentInfo = {
        amount: paymentInfo.amount || course.price?.usd || 0,
        currency: paymentInfo.currency || "USD",
        paymentMethod: paymentInfo.paymentMethod || "unknown",
        paymentDate: new Date(),
        paymentStatus: paymentInfo.paymentStatus || "completed",
        transactionId: paymentInfo.transactionId,
      };
    }

    const enrollment = new Enrollment(enrollmentData);
    await enrollment.save();

    // Update course enrollment count
    await Course.findByIdAndUpdate(courseId, {
      $inc: { enrollmentCount: 1 },
    });

    // Create notification for course author
    const notification = new Notification({
      recipient: {
        _id: course.author._id,
        email: course.author.email,
      },
      sender: {
        _id: user._id,
        email: user.email,
        name: student.name,
        picture: student.picture,
      },
      type: "course",
      content: `${student.name} enrolled in your course: ${course.title}${
        isFree ? " (Free)" : ""
      }`,
      metadata: {
        itemId: courseId,
        itemType: "course",
        enrollmentId: enrollment._id.toString(),
        isFree,
      },
    });

    await notification.save();

    // Send FCM notification to course author
    try {
      await FCMHandler.sendToUser(course.author._id, {
        title: "New Course Enrollment",
        body: `${student.name} enrolled in ${course.title}${
          isFree ? " (Free Course)" : ""
        }`,
        type: "course_enrollment",
        data: {
          courseId,
          enrollmentId: enrollment._id.toString(),
          isFree: isFree.toString(),
        },
      });
    } catch (fcmError) {
      console.error("Failed to send FCM notification:", fcmError);
    }

    return res.status(201).json(
      GenRes(
        201,
        {
          ...enrollment.toObject(),
          enrollmentType: isFree ? "free" : "paid",
        },
        null,
        `Successfully enrolled in ${isFree ? "free" : "paid"} course`
      )
    );
  } catch (error) {
    console.error("Error enrolling in course:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's enrollments with enhanced filtering
const GetUserEnrollments = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 10,
      status,
      sortBy = "enrollmentDate",
      sortOrder = "desc",
      courseType = "all", // all, free, paid
    } = req.query;
    const userId = req.user._id;

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50);

    const filters = { "student._id": userId };
    if (status) {
      filters.status = status;
    }

    // Filter by course type
    if (courseType === "free") {
      filters["course.isFree"] = true;
    } else if (courseType === "paid") {
      filters["course.isFree"] = { $ne: true };
    }

    const sortDirection = sortOrder === "desc" ? -1 : 1;
    const sortObj = { [sortBy]: sortDirection };

    const [enrollments, total] = await Promise.all([
      Enrollment.find(filters)
        .sort(sortObj)
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      Enrollment.countDocuments(filters),
    ]);

    // Enrich with additional course data and progress insights
    const enrichedEnrollments = enrollments.map((enrollment) => ({
      ...enrollment,
      progressSummary: {
        isCompleted: enrollment.progress.completionPercentage >= 100,
        daysSinceEnrollment: Math.floor(
          (Date.now() - new Date(enrollment.enrollmentDate).getTime()) /
            (1000 * 60 * 60 * 24)
        ),
        averageTimePerNote:
          enrollment.progress.completedNotes.length > 0
            ? Math.round(
                enrollment.progress.totalTimeSpent /
                  enrollment.progress.completedNotes.length
              )
            : 0,
        canRate:
          enrollment.progress.completionPercentage >=
          (enrollment.course.isFree ? 0 : 25),
        estimatedTimeToComplete: calculateEstimatedTimeToComplete(enrollment),
      },
      accessInfo: {
        hasExpired:
          enrollment.accessSettings.expiryDate &&
          new Date() > enrollment.accessSettings.expiryDate,
        daysUntilExpiry: enrollment.accessSettings.expiryDate
          ? Math.ceil(
              (enrollment.accessSettings.expiryDate - new Date()) /
                (1000 * 60 * 60 * 24)
            )
          : null,
        canDownload: enrollment.accessSettings.downloadAllowed,
      },
    }));

    // Calculate summary statistics
    const summary = {
      totalEnrollments: total,
      freeEnrollments: enrollments.filter((e) => e.course.isFree).length,
      paidEnrollments: enrollments.filter((e) => !e.course.isFree).length,
      activeEnrollments: enrollments.filter((e) => e.status === "active")
        .length,
      completedEnrollments: enrollments.filter(
        (e) => e.progress.completionPercentage >= 100
      ).length,
      totalTimeSpent: enrollments.reduce(
        (sum, e) => sum + (e.progress.totalTimeSpent || 0),
        0
      ),
      averageProgress:
        enrollments.length > 0
          ? enrollments.reduce(
              (sum, e) => sum + e.progress.completionPercentage,
              0
            ) / enrollments.length
          : 0,
    };

    return res.status(200).json(
      GenRes(
        200,
        {
          enrollments: enrichedEnrollments,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum),
            hasMore: (pageNum + 1) * limitNum < total,
          },
          summary,
        },
        null,
        `Retrieved ${enrollments.length} enrollments`
      )
    );
  } catch (error) {
    console.error("Error getting user enrollments:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Helper function to calculate estimated time to complete
function calculateEstimatedTimeToComplete(enrollment) {
  const { completionPercentage, totalTimeSpent, completedNotes } =
    enrollment.progress;
  const { totalNotes } = enrollment.course;

  if (completionPercentage >= 100) return 0;
  if (completedNotes.length === 0) return null;

  const averageTimePerNote = totalTimeSpent / completedNotes.length;
  const remainingNotes = totalNotes - completedNotes.length;

  return Math.round((averageTimePerNote * remainingNotes) / 60); // Return in minutes
}

// Update course progress with enhanced tracking
const UpdateCourseProgress = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      noteId,
      completed = true,
      timeSpent = 0,
      difficulty,
      notes,
    } = req.body;
    const userId = req.user._id;

    if (!isValidObjectId(courseId) || !isValidObjectId(noteId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or note ID"
          )
        );
    }

    // Find enrollment
    const enrollment = await Enrollment.findOne({
      "student._id": userId,
      "course._id": courseId,
    });

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "You are not enrolled in this course"
          )
        );
    }

    // Check if access has expired (only for paid courses)
    if (
      !enrollment.course.isFree &&
      enrollment.accessSettings.expiryDate &&
      new Date() > enrollment.accessSettings.expiryDate
    ) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Access expired" },
            "Your access to this course has expired"
          )
        );
    }

    // Get course to validate note exists
    const course = await Course.findById(courseId).select("notes");
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const noteExists = course.notes.some(
      (note) => note._id.toString() === noteId
    );
    if (!noteExists) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "Note not found" }, "Note not found"));
    }

    // Update progress
    const existingNoteIndex = enrollment.progress.completedNotes.findIndex(
      (note) => note.noteId === noteId
    );

    if (completed) {
      if (existingNoteIndex === -1) {
        // Add new completed note
        enrollment.progress.completedNotes.push({
          noteId,
          completedAt: new Date(),
          timeSpent,
          attempts: 1,
          difficulty,
          notes,
        });
      } else {
        // Update existing note
        enrollment.progress.completedNotes[existingNoteIndex].timeSpent +=
          timeSpent;
        enrollment.progress.completedNotes[existingNoteIndex].attempts += 1;
        if (difficulty) {
          enrollment.progress.completedNotes[existingNoteIndex].difficulty =
            difficulty;
        }
        if (notes) {
          enrollment.progress.completedNotes[existingNoteIndex].notes = notes;
        }
      }
    } else {
      // Remove from completed notes
      if (existingNoteIndex !== -1) {
        enrollment.progress.completedNotes.splice(existingNoteIndex, 1);
      }
    }

    // Update last accessed note
    enrollment.progress.lastAccessedNote = {
      noteId,
      accessedAt: new Date(),
    };

    // Update total time spent
    enrollment.progress.totalTimeSpent += timeSpent;

    // Check if course is completed
    const wasCompleted = enrollment.progress.completionPercentage >= 100;
    await enrollment.save();

    const isNowCompleted = enrollment.progress.completionPercentage >= 100;

    // If just completed, issue certificate and send notification
    if (!wasCompleted && isNowCompleted) {
      enrollment.status = "completed";
      enrollment.certificate.issued = true;
      enrollment.certificate.issuedDate = new Date();
      enrollment.certificate.certificateId = `CERT_${courseId}_${userId}_${Date.now()}`;

      await enrollment.save();

      // Send completion notification
      try {
        await FCMHandler.sendToUser(userId, {
          title: "Course Completed! 🎉",
          body: `Congratulations! You've completed ${enrollment.course.title}`,
          type: "course_completion",
          data: {
            courseId,
            certificateId: enrollment.certificate.certificateId,
            isFree: enrollment.course.isFree.toString(),
          },
        });
      } catch (fcmError) {
        console.error("Failed to send completion notification:", fcmError);
      }
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          progress: enrollment.progress,
          certificate: enrollment.certificate,
          status: enrollment.status,
          justCompleted: !wasCompleted && isNowCompleted,
          canRate:
            enrollment.progress.completionPercentage >=
            (enrollment.course.isFree ? 0 : 25),
        },
        null,
        "Progress updated successfully"
      )
    );
  } catch (error) {
    console.error("Error updating course progress:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get course progress
const GetCourseProgress = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const enrollment = await Enrollment.findOne({
      "student._id": userId,
      "course._id": courseId,
    }).lean();

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "You are not enrolled in this course"
          )
        );
    }

    // Get detailed course information
    const course = await Course.findById(courseId).select("notes title").lean();

    // Create detailed progress report
    const detailedProgress = {
      enrollment: {
        ...enrollment,
        progressSummary: {
          isCompleted: enrollment.progress.completionPercentage >= 100,
          daysSinceEnrollment: Math.floor(
            (Date.now() - new Date(enrollment.enrollmentDate).getTime()) /
              (1000 * 60 * 60 * 24)
          ),
          averageTimePerNote:
            enrollment.progress.completedNotes.length > 0
              ? Math.round(
                  enrollment.progress.totalTimeSpent /
                    enrollment.progress.completedNotes.length
                )
              : 0,
          canRate:
            enrollment.progress.completionPercentage >=
            (enrollment.course.isFree ? 0 : 25),
          estimatedTimeToComplete: calculateEstimatedTimeToComplete(enrollment),
        },
        accessInfo: {
          hasExpired:
            enrollment.accessSettings.expiryDate &&
            new Date() > enrollment.accessSettings.expiryDate,
          daysUntilExpiry: enrollment.accessSettings.expiryDate
            ? Math.ceil(
                (enrollment.accessSettings.expiryDate - new Date()) /
                  (1000 * 60 * 60 * 24)
              )
            : null,
          canDownload: enrollment.accessSettings.downloadAllowed,
        },
      },
      courseNotes: course.notes.map((note) => {
        const completedNote = enrollment.progress.completedNotes.find(
          (cn) => cn.noteId === note._id.toString()
        );
        return {
          _id: note._id,
          name: note.name,
          fileType: note.fileType,
          premium: note.premium,
          completed: !!completedNote,
          completedAt: completedNote?.completedAt,
          timeSpent: completedNote?.timeSpent || 0,
          attempts: completedNote?.attempts || 0,
          difficulty: completedNote?.difficulty,
          notes: completedNote?.notes,
        };
      }),
    };

    return res
      .status(200)
      .json(
        GenRes(200, detailedProgress, null, "Progress retrieved successfully")
      );
  } catch (error) {
    console.error("Error getting course progress:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Add personal note
const AddPersonalNote = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { content, noteType = "personal", noteId } = req.body;
    const userId = req.user._id;

    if (!content) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Content required" },
            "Note content required"
          )
        );
    }

    const enrollment = await Enrollment.findOne({
      "student._id": userId,
      "course._id": courseId,
    });

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "You are not enrolled in this course"
          )
        );
    }

    enrollment.notes.push({
      content,
      noteType,
      noteId, // Reference to specific course note if applicable
      createdAt: new Date(),
    });

    await enrollment.save();

    return res
      .status(200)
      .json(GenRes(200, enrollment.notes, null, "Note added successfully"));
  } catch (error) {
    console.error("Error adding personal note:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Submit course feedback
const SubmitCourseFeedback = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { rating, review, suggestions } = req.body;
    const userId = req.user._id;

    if (!rating || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid rating" },
            "Rating must be between 1 and 5"
          )
        );
    }

    const enrollment = await Enrollment.findOne({
      "student._id": userId,
      "course._id": courseId,
    });

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "You are not enrolled in this course"
          )
        );
    }

    // For free courses, allow feedback immediately
    // For paid courses, require at least 50% completion
    const minimumProgress = enrollment.course.isFree ? 0 : 50;

    if (enrollment.progress.completionPercentage < minimumProgress) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Insufficient progress" },
            `Complete at least ${minimumProgress}% of the course to submit feedback`
          )
        );
    }

    enrollment.feedback = {
      rating,
      review,
      suggestions,
      reviewDate: new Date(),
    };

    await enrollment.save();

    const allRatings = await Enrollment.find({
      "course._id": courseId,
      "feedback.rating": { $exists: true },
    }).select("feedback.rating");

    if (allRatings.length > 0) {
      const averageRating =
        allRatings.reduce(
          (sum, enrollment) => sum + enrollment.feedback.rating,
          0
        ) / allRatings.length;

      await Course.findByIdAndUpdate(courseId, {
        $set: {
          "rating.average": Math.round(averageRating * 10) / 10,
          "rating.count": allRatings.length,
        },
      });
    }

    return res
      .status(200)
      .json(
        GenRes(
          200,
          enrollment.feedback,
          null,
          "Feedback submitted successfully"
        )
      );
  } catch (error) {
    console.error("Error submitting course feedback:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get enrollment analytics (for course authors)
const GetEnrollmentAnalytics = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id;

    // Verify user is the course author or admin
    const course = await Course.findById(courseId).select("author");
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    if (course.author._id !== userId && req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Access denied" },
            "Only course author or admin can view analytics"
          )
        );
    }

    const analytics = await Enrollment.aggregate([
      { $match: { "course._id": courseId } },
      {
        $group: {
          _id: null,
          totalEnrollments: { $sum: 1 },
          freeEnrollments: {
            $sum: { $cond: ["$course.isFree", 1, 0] },
          },
          paidEnrollments: {
            $sum: { $cond: [{ $not: "$course.isFree" }, 1, 0] },
          },
          activeEnrollments: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          completedEnrollments: {
            $sum: {
              $cond: [{ $gte: ["$progress.completionPercentage", 100] }, 1, 0],
            },
          },
          averageProgress: { $avg: "$progress.completionPercentage" },
          totalRevenue: { $sum: "$paymentInfo.amount" },
          averageRating: { $avg: "$feedback.rating" },
          totalTimeSpent: { $sum: "$progress.totalTimeSpent" },
        },
      },
    ]);

    const enrollmentTrends = await Enrollment.aggregate([
      { $match: { "course._id": courseId } },
      {
        $group: {
          _id: {
            year: { $year: "$enrollmentDate" },
            month: { $month: "$enrollmentDate" },
            type: { $cond: ["$course.isFree", "free", "paid"] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          analytics: analytics[0] || {},
          enrollmentTrends,
        },
        null,
        "Analytics retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error getting enrollment analytics:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  EnrollInCourse,
  GetUserEnrollments,
  UpdateCourseProgress,
  GetCourseProgress,
  AddPersonalNote,
  SubmitCourseFeedback,
  GetEnrollmentAnalytics,
};
