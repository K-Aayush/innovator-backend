const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const SubcategoryEnrollment = require("./subcategory.enrollment.model");
const EnhancedCourse = require("./course.enhanced.model");
const Notification = require("../notifications/notification.model");
const FCMHandler = require("../../utils/notification/fcmHandler");

// Update course progress within enrollment
const UpdateCourseProgressInEnrollment = async (req, res) => {
  try {
    const { enrollmentId, courseId } = req.params;
    const { completionPercentage, timeSpent = 0, notes } = req.body;
    const userId = req.user._id;

    if (!isValidObjectId(enrollmentId) || !isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid enrollment or course ID"
          )
        );
    }

    if (completionPercentage < 0 || completionPercentage > 100) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid completion percentage" },
            "Completion percentage must be between 0 and 100"
          )
        );
    }

    // Find enrollment
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

    // Verify course belongs to enrolled subcategory
    const course = await EnhancedCourse.findById(courseId).select(
      "subcategory title"
    );
    if (!course || course.subcategory._id !== enrollment.subcategory._id) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Course not accessible" },
            "Course is not part of your enrolled subcategory"
          )
        );
    }

    // Update or add course progress
    const existingProgressIndex =
      enrollment.progress.completedCourses.findIndex(
        (cp) => cp.courseId === courseId
      );

    const wasCompleted =
      existingProgressIndex !== -1 &&
      enrollment.progress.completedCourses[existingProgressIndex]
        .completionPercentage >= 100;
    const isNowCompleted = completionPercentage >= 100;

    if (existingProgressIndex !== -1) {
      // Update existing progress
      enrollment.progress.completedCourses[
        existingProgressIndex
      ].completionPercentage = completionPercentage;
      enrollment.progress.completedCourses[existingProgressIndex].timeSpent +=
        timeSpent;
      if (isNowCompleted && !wasCompleted) {
        enrollment.progress.completedCourses[
          existingProgressIndex
        ].completedAt = new Date();
      }
    } else {
      // Add new course progress
      enrollment.progress.completedCourses.push({
        courseId,
        completionPercentage,
        timeSpent,
        completedAt: isNowCompleted ? new Date() : null,
      });
    }

    // Update last accessed course
    enrollment.progress.lastAccessedCourse = {
      courseId,
      accessedAt: new Date(),
    };

    // Update total time spent
    enrollment.progress.totalTimeSpent += timeSpent;

    // Update total completed courses count
    enrollment.progress.totalCoursesCompleted =
      enrollment.progress.completedCourses.filter(
        (cp) => cp.completionPercentage >= 100
      ).length;

    await enrollment.save();

    // Send completion notification if course just completed
    if (!wasCompleted && isNowCompleted) {
      // Create notification for course completion
      const courseCompletionNotification = new Notification({
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
        content: `Congratulations! You've completed ${course.title}`,
        metadata: {
          itemId: courseId,
          itemType: "course",
          enrollmentId: enrollment._id.toString(),
          subcategoryId: enrollment.subcategory._id,
          action: "course_completed",
        },
      });

      await courseCompletionNotification.save();
      try {
        await FCMHandler.sendToUser(userId, {
          title: "Course Completed! 🎉",
          body: `Congratulations! You've completed ${course.title}`,
          type: "course_completion",
          data: {
            courseId,
            enrollmentId: enrollment._id.toString(),
            subcategoryId: enrollment.subcategory._id,
          },
        });
      } catch (fcmError) {
        console.error("Failed to send completion notification:", fcmError);
      }
    }

    // Check if subcategory is completed (all courses 100%)
    const allCourses = await EnhancedCourse.find({
      "subcategory._id": enrollment.subcategory._id,
      isPublished: true,
    }).select("_id");

    const allCoursesCompleted = allCourses.every((course) => {
      const progress = enrollment.progress.completedCourses.find(
        (cp) => cp.courseId === course._id.toString()
      );
      return progress && progress.completionPercentage >= 100;
    });

    if (allCoursesCompleted && enrollment.status !== "completed") {
      enrollment.status = "completed";
      enrollment.certificate.issued = true;
      enrollment.certificate.issuedDate = new Date();
      enrollment.certificate.certificateId = `CERT_${
        enrollment.subcategory._id
      }_${userId}_${Date.now()}`;

      await enrollment.save();

      // Create notification for subcategory completion
      const subcategoryCompletionNotification = new Notification({
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
        content: `Amazing! You've completed all courses in ${enrollment.subcategory.name}`,
        metadata: {
          itemId: enrollment.subcategory._id,
          itemType: "subcategory",
          enrollmentId: enrollment._id.toString(),
          action: "subcategory_completed",
          certificateId: enrollment.certificate.certificateId,
        },
      });

      await subcategoryCompletionNotification.save();
      // Send subcategory completion notification
      try {
        await FCMHandler.sendToUser(userId, {
          title: "Subcategory Completed! 🏆",
          body: `Amazing! You've completed all courses in ${enrollment.subcategory.name}`,
          type: "subcategory_completion",
          data: {
            subcategoryId: enrollment.subcategory._id,
            enrollmentId: enrollment._id.toString(),
            certificateId: enrollment.certificate.certificateId,
          },
        });
      } catch (fcmError) {
        console.error(
          "Failed to send subcategory completion notification:",
          fcmError
        );
      }
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          progress: enrollment.progress,
          certificate: enrollment.certificate,
          status: enrollment.status,
          courseCompleted: !wasCompleted && isNowCompleted,
          subcategoryCompleted: allCoursesCompleted,
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

// Get enrollment progress details
const GetEnrollmentProgress = async (req, res) => {
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

    // Get all courses in the subcategory
    const courses = await EnhancedCourse.find({
      "subcategory._id": enrollment.subcategory._id,
      isPublished: true,
    })
      .select("title description thumbnail lessons notes videos")
      .lean();

    // Create detailed progress report
    const coursesWithProgress = courses.map((course) => {
      const courseProgress = enrollment.progress.completedCourses.find(
        (cp) => cp.courseId === course._id.toString()
      );

      return {
        _id: course._id,
        title: course.title,
        description: course.description,
        thumbnail: course.thumbnail,
        contentCounts: {
          lessons: course.lessons?.length || 0,
          notes: course.notes?.length || 0,
          videos: course.videos?.length || 0,
        },
        progress: courseProgress || {
          completionPercentage: 0,
          timeSpent: 0,
          completedAt: null,
        },
        isCompleted: courseProgress
          ? courseProgress.completionPercentage >= 100
          : false,
      };
    });

    const progressSummary = {
      totalCourses: courses.length,
      completedCourses: enrollment.progress.totalCoursesCompleted,
      overallProgress: enrollment.progress.overallProgress,
      totalTimeSpent: enrollment.progress.totalTimeSpent,
      streakDays: enrollment.progress.streakDays,
      lastActivity: enrollment.progress.lastActivityDate,
      canGetCertificate: enrollment.status === "completed",
      daysSinceEnrollment: Math.floor(
        (Date.now() - new Date(enrollment.enrollmentDate).getTime()) /
          (1000 * 60 * 60 * 24)
      ),
    };

    return res.status(200).json(
      GenRes(
        200,
        {
          enrollment,
          courses: coursesWithProgress,
          summary: progressSummary,
        },
        null,
        "Progress details retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error getting enrollment progress:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get course content with enrollment check
const GetCourseContentForEnrolled = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { lessonId } = req.query;
    const userId = req.user._id;
    const enrollment = req.enrollment; // From middleware

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await EnhancedCourse.findById(courseId).lean();
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Verify course belongs to enrolled subcategory
    if (course.subcategory._id !== enrollment.subcategory._id) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Course not accessible" },
            "Course is not part of your enrolled subcategory"
          )
        );
    }

    let responseData = {
      course: {
        ...course,
        contentStructure: {
          totalLessons: course.lessons?.length || 0,
          totalNotes: course.notes?.length || 0,
          totalVideos: course.videos?.length || 0,
        },
      },
      lessons: course.lessons || [],
      enrollment: {
        canAccessVideos: enrollment.accessSettings.canAccessVideos,
        canAccessNotes: enrollment.accessSettings.canAccessNotes,
        canDownloadContent: enrollment.accessSettings.canDownloadContent,
      },
    };

    // Filter content based on access permissions
    if (lessonId) {
      if (!isValidObjectId(lessonId)) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "Invalid lesson ID" },
              "Invalid lesson ID"
            )
          );
      }

      const lesson = course.lessons?.find((l) => l._id.toString() === lessonId);
      if (!lesson) {
        return res
          .status(404)
          .json(
            GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
          );
      }

      responseData.selectedLesson = lesson;

      // Filter notes based on access
      responseData.notes = enrollment.accessSettings.canAccessNotes
        ? course.notes?.filter(
            (note) => note.lessonId && note.lessonId.toString() === lessonId
          ) || []
        : [];

      // Filter videos based on access
      responseData.videos = enrollment.accessSettings.canAccessVideos
        ? course.videos?.filter(
            (video) => video.lessonId && video.lessonId.toString() === lessonId
          ) || []
        : [];
    } else {
      // Show all content based on permissions
      responseData.notes = enrollment.accessSettings.canAccessNotes
        ? course.notes || []
        : [];
      responseData.videos = enrollment.accessSettings.canAccessVideos
        ? course.videos || []
        : [];
      responseData.selectedLesson = null;
    }

    return res
      .status(200)
      .json(
        GenRes(200, responseData, null, "Course content retrieved successfully")
      );
  } catch (error) {
    console.error("Error getting course content:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  UpdateCourseProgressInEnrollment,
  GetEnrollmentProgress,
  GetCourseContentForEnrolled,
};
