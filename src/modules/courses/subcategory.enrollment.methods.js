const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const SubcategoryEnrollment = require("./subcategory.enrollment.model");
const CourseCategory = require("./course.hierarchy.model");
const EnhancedCourse = require("./course.enhanced.model");
const User = require("../user/user.model");
const Notification = require("../notifications/notification.model");
const FCMHandler = require("../../utils/notification/fcmHandler");

// Enroll in subcategory
const EnrollInSubcategory = async (req, res) => {
  try {
    const { subcategoryId } = req.params;
    const { name, phone, city, country } = req.body;
    const user = req.user;

    // Validate required fields
    if (!name || !phone || !city || !country) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "All fields are required" },
            "Please provide name, phone, city, and country"
          )
        );
    }

    if (!isValidObjectId(subcategoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid subcategory ID" },
            "Invalid subcategory ID"
          )
        );
    }

    // Find the subcategory
    const subcategory = await CourseCategory.findById(subcategoryId).populate(
      "parentCategory"
    );
    if (!subcategory || subcategory.level !== "subcategory") {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Subcategory not found" },
            "Subcategory not found"
          )
        );
    }

    // Check if user is already enrolled
    const existingEnrollment = await SubcategoryEnrollment.findOne({
      "student._id": user._id,
      "subcategory._id": subcategoryId,
    });

    if (existingEnrollment) {
      return res
        .status(409)
        .json(
          GenRes(
            409,
            existingEnrollment,
            { error: "Already enrolled" },
            "You are already enrolled in this subcategory"
          )
        );
    }

    // Get user details
    const student = await User.findById(user._id).select(
      "_id email name picture"
    );

    // Get parent category details
    const parentCategory = await CourseCategory.findById(
      subcategory.parentCategory
    );

    // Create enrollment
    const enrollmentData = {
      student: {
        _id: student._id.toString(),
        email: student.email,
        name: name,
        phone: phone,
        city: city,
        country: country,
        picture: student.picture || "",
      },
      subcategory: {
        _id: subcategory._id.toString(),
        name: subcategory.name,
        slug: subcategory.slug,
        parentCategory: {
          _id: parentCategory._id.toString(),
          name: parentCategory.name,
          slug: parentCategory.slug,
        },
      },
      accessSettings: {
        canAccessVideos: true,
        canAccessNotes: true,
        canDownloadContent: false,
        maxDevices: 3,
      },
    };

    const enrollment = new SubcategoryEnrollment(enrollmentData);
    await enrollment.save();

    // Update subcategory enrollment count
    await CourseCategory.findByIdAndUpdate(subcategoryId, {
      $inc: { "metadata.totalEnrollments": 1 },
    });

    // Create notification for enrollment success
    const notification = new Notification({
      recipient: {
        _id: user._id,
        email: user.email,
      },
      sender: {
        _id: "system",
        email: "system@platform.com",
        name: "System",
        picture: "",
      },
      type: "course",
      content: `You have successfully enrolled in ${subcategory.name}`,
      metadata: {
        itemId: subcategoryId,
        itemType: "subcategory",
        enrollmentId: enrollment._id.toString(),
        action: "enrollment_success",
      },
    });

    await notification.save();
    // Send FCM notification to user
    try {
      await FCMHandler.sendToUser(user._id, {
        title: "Enrollment Successful! 🎉",
        body: `You've successfully enrolled in ${subcategory.name}`,
        type: "enrollment_success",
        data: {
          subcategoryId,
          enrollmentId: enrollment._id.toString(),
        },
      });
    } catch (fcmError) {
      console.error("Failed to send FCM notification:", fcmError);
    }

    return res
      .status(201)
      .json(
        GenRes(
          201,
          enrollment.toObject(),
          null,
          "Successfully enrolled in subcategory"
        )
      );
  } catch (error) {
    console.error("Error enrolling in subcategory:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update enrollment information
const UpdateEnrollmentInfo = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { name, phone, city, country } = req.body;
    const userId = req.user._id;

    if (!isValidObjectId(enrollmentId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid enrollment ID" },
            "Invalid enrollment ID"
          )
        );
    }

    // Validate required fields
    if (!name || !phone || !city || !country) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "All fields are required" },
            "Please provide name, phone, city, and country"
          )
        );
    }

    const enrollment = await SubcategoryEnrollment.findOne({
      _id: enrollmentId,
      "student._id": userId,
      status: "active",
    });

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "Enrollment not found or not accessible"
          )
        );
    }

    // Update student information
    enrollment.student.name = name;
    enrollment.student.phone = phone;
    enrollment.student.city = city;
    enrollment.student.country = country;

    await enrollment.save();

    // Create notification for profile update
    const notification = new Notification({
      recipient: {
        _id: userId,
        email: req.user.email,
      },
      sender: {
        _id: "system",
        email: "system@platform.com",
        name: "System",
        picture: "",
      },
      type: "course",
      content: `Your enrollment information for ${enrollment.subcategory.name} has been updated`,
      metadata: {
        itemId: enrollment.subcategory._id,
        itemType: "subcategory",
        enrollmentId: enrollment._id.toString(),
        action: "enrollment_info_updated",
      },
    });

    await notification.save();
    return res
      .status(200)
      .json(
        GenRes(
          200,
          enrollment,
          null,
          "Enrollment information updated successfully"
        )
      );
  } catch (error) {
    console.error("Error updating enrollment info:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Cancel enrollment
const CancelEnrollment = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { reason, feedback } = req.body;
    const userId = req.user._id;

    if (!isValidObjectId(enrollmentId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid enrollment ID" },
            "Invalid enrollment ID"
          )
        );
    }

    const enrollment = await SubcategoryEnrollment.findOne({
      _id: enrollmentId,
      "student._id": userId,
      status: "active",
    });

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "Active enrollment not found"
          )
        );
    }

    // Update enrollment status and cancellation info
    enrollment.status = "cancelled";
    enrollment.cancellationInfo = {
      cancelledAt: new Date(),
      reason: reason || "No reason provided",
      feedback: feedback || "",
    };

    await enrollment.save();

    // Update subcategory enrollment count
    await CourseCategory.findByIdAndUpdate(enrollment.subcategory._id, {
      $inc: { "metadata.totalEnrollments": -1 },
    });

    // Create notification for enrollment cancellation
    const notification = new Notification({
      recipient: {
        _id: userId,
        email: req.user.email,
      },
      sender: {
        _id: "system",
        email: "system@platform.com",
        name: "System",
        picture: "",
      },
      type: "course",
      content: `Your enrollment in ${enrollment.subcategory.name} has been cancelled`,
      metadata: {
        itemId: enrollment.subcategory._id,
        itemType: "subcategory",
        enrollmentId: enrollment._id.toString(),
        action: "enrollment_cancelled",
        reason: reason || "No reason provided",
      },
    });

    await notification.save();
    // Send FCM notification
    try {
      await FCMHandler.sendToUser(userId, {
        title: "Enrollment Cancelled",
        body: `Your enrollment in ${enrollment.subcategory.name} has been cancelled`,
        type: "enrollment_cancelled",
        data: {
          subcategoryId: enrollment.subcategory._id,
          enrollmentId: enrollment._id.toString(),
        },
      });
    } catch (fcmError) {
      console.error("Failed to send FCM notification:", fcmError);
    }

    return res
      .status(200)
      .json(GenRes(200, enrollment, null, "Enrollment cancelled successfully"));
  } catch (error) {
    console.error("Error cancelling enrollment:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's enrollments
const GetUserEnrollments = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 10,
      status,
      sortBy = "enrollmentDate",
      sortOrder = "desc",
    } = req.query;
    const userId = req.user._id;

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50);

    const filters = { "student._id": userId };
    if (status) {
      filters.status = status;
    }

    const sortDirection = sortOrder === "desc" ? -1 : 1;
    const sortObj = { [sortBy]: sortDirection };

    const [enrollments, total] = await Promise.all([
      SubcategoryEnrollment.find(filters)
        .sort(sortObj)
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      SubcategoryEnrollment.countDocuments(filters),
    ]);

    // Enrich with course counts
    const enrichedEnrollments = await Promise.all(
      enrollments.map(async (enrollment) => {
        const courseCount = await EnhancedCourse.countDocuments({
          "subcategory._id": enrollment.subcategory._id,
          isPublished: true,
        });

        return {
          ...enrollment,
          availableCourses: courseCount,
          progressSummary: {
            isCompleted: enrollment.progress.overallProgress >= 100,
            daysSinceEnrollment: Math.floor(
              (Date.now() - new Date(enrollment.enrollmentDate).getTime()) /
                (1000 * 60 * 60 * 24)
            ),
            canRate: enrollment.progress.overallProgress >= 25,
          },
        };
      })
    );

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

// Get enrollment details
const GetEnrollmentDetails = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const userId = req.user._id;

    if (!isValidObjectId(enrollmentId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid enrollment ID" },
            "Invalid enrollment ID"
          )
        );
    }

    const enrollment = await SubcategoryEnrollment.findOne({
      _id: enrollmentId,
      "student._id": userId,
    }).lean();

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "Enrollment not found"
          )
        );
    }

    // Get available courses in this subcategory
    const courses = await EnhancedCourse.find({
      "subcategory._id": enrollment.subcategory._id,
      isPublished: true,
    })
      .select("title description thumbnail lessons notes videos")
      .lean();

    // Enrich courses with progress
    const coursesWithProgress = courses.map((course) => {
      const courseProgress = enrollment.progress.completedCourses.find(
        (cp) => cp.courseId === course._id.toString()
      );

      return {
        ...course,
        progress: courseProgress || {
          completionPercentage: 0,
          timeSpent: 0,
          completed: false,
        },
        contentCounts: {
          lessons: course.lessons?.length || 0,
          notes: course.notes?.length || 0,
          videos: course.videos?.length || 0,
        },
      };
    });

    const detailedEnrollment = {
      ...enrollment,
      availableCourses: coursesWithProgress,
      summary: {
        totalCourses: courses.length,
        completedCourses: enrollment.progress.completedCourses.length,
        overallProgress: enrollment.progress.overallProgress,
        canAccessContent: enrollment.status === "active",
        daysSinceEnrollment: Math.floor(
          (Date.now() - new Date(enrollment.enrollmentDate).getTime()) /
            (1000 * 60 * 60 * 24)
        ),
      },
    };

    return res
      .status(200)
      .json(
        GenRes(200, detailedEnrollment, null, "Enrollment details retrieved")
      );
  } catch (error) {
    console.error("Error getting enrollment details:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Check enrollment access for content
const CheckEnrollmentAccess = async (req, res) => {
  try {
    const { subcategoryId } = req.params;
    const userId = req.user._id;

    if (!isValidObjectId(subcategoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid subcategory ID" },
            "Invalid subcategory ID"
          )
        );
    }

    const enrollment = await SubcategoryEnrollment.findOne({
      "student._id": userId,
      "subcategory._id": subcategoryId,
      status: "active",
    }).lean();

    const hasAccess = !!enrollment;

    return res.status(200).json(
      GenRes(
        200,
        {
          hasAccess,
          enrollment: hasAccess ? enrollment : null,
          accessSettings: hasAccess ? enrollment.accessSettings : null,
        },
        null,
        hasAccess ? "Access granted" : "Access denied"
      )
    );
  } catch (error) {
    console.error("Error checking enrollment access:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Submit subcategory feedback
const SubmitSubcategoryFeedback = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
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

    const enrollment = await SubcategoryEnrollment.findOne({
      _id: enrollmentId,
      "student._id": userId,
    });

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "Enrollment not found"
          )
        );
    }

    // Require at least 25% progress to submit feedback
    if (enrollment.progress.overallProgress < 25) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Insufficient progress" },
            "Complete at least 25% to submit feedback"
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

    // Create notification for feedback submission
    const notification = new Notification({
      recipient: {
        _id: userId,
        email: req.user.email,
      },
      sender: {
        _id: "system",
        email: "system@platform.com",
        name: "System",
        picture: "",
      },
      type: "course",
      content: `Thank you for your feedback on ${enrollment.subcategory.name}`,
      metadata: {
        itemId: enrollment.subcategory._id,
        itemType: "subcategory",
        enrollmentId: enrollment._id.toString(),
        action: "feedback_submitted",
        rating: rating,
      },
    });

    await notification.save();
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
    console.error("Error submitting feedback:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Add personal note
const AddPersonalNote = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { content, courseId, lessonId, noteType = "personal" } = req.body;
    const userId = req.user._id;

    if (!content) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Content required" },
            "Note content is required"
          )
        );
    }

    const enrollment = await SubcategoryEnrollment.findOne({
      _id: enrollmentId,
      "student._id": userId,
      status: "active",
    });

    if (!enrollment) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Enrollment not found" },
            "Active enrollment not found"
          )
        );
    }

    enrollment.personalNotes.push({
      content,
      courseId,
      lessonId,
      noteType,
      createdAt: new Date(),
    });

    await enrollment.save();

    return res
      .status(200)
      .json(
        GenRes(200, enrollment.personalNotes, null, "Note added successfully")
      );
  } catch (error) {
    console.error("Error adding personal note:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  EnrollInSubcategory,
  UpdateEnrollmentInfo,
  CancelEnrollment,
  GetUserEnrollments,
  GetEnrollmentDetails,
  CheckEnrollmentAccess,
  SubmitSubcategoryFeedback,
  AddPersonalNote,
};
