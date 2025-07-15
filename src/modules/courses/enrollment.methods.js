const Enrollment = require("./enrollment.model");
const Certificate = require("./certificate.model");
const EnhancedCourse = require("./course.enhanced.model");
const User = require("../user/user.model");
const Notification = require("../notifications/notification.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const FCMHandler = require("../../utils/notification/fcmHandler");
const CertificateGenerator = require("./certificate.generator");
const path = require("path");

// Enroll in a course
const EnrollInCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { paymentInfo, phone, location } = req.body;
    const user = req.user;

    if (!phone || !location) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Phone and location are required" },
            "Phone and location are required"
          )
        );
    }

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    // Get course details
    const course = await EnhancedCourse.findById(courseId).lean();
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    if (!course.isPublished) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Course not available" },
            "Course is not published"
          )
        );
    }

    // Check if already enrolled
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
            null,
            { error: "Already enrolled" },
            "You are already enrolled in this course"
          )
        );
    }

    // Get user details
    const userDetails = await User.findById(user._id)
      .select("name email picture")
      .lean();

    // Determine if course is free
    const isFree = !course.price?.usd || course.price.usd === 0;

    // Create enrollment
    const enrollment = new Enrollment({
      student: {
        _id: userDetails._id,
        email: userDetails.email,
        name: userDetails.name,
        picture: userDetails.picture,
        phone,
        location,
      },
      course: {
        _id: course._id,
        title: course.title,
        thumbnail: course.thumbnail,
        price: course.price,
        isFree,
      },
      progress: {
        totalLessons: course.lessons?.length || 0,
        totalVideos: course.videos?.length || 0,
        totalNotes: course.notes?.length || 0,
      },
      paymentInfo: isFree
        ? {
            amount: 0,
            currency: "USD",
            paymentStatus: "completed",
          }
        : paymentInfo,
      metadata: {
        enrollmentSource: "website",
        deviceInfo: req.headers["user-agent"],
        ipAddress: req.ip,
      },
    });

    await enrollment.save();

    // Update course enrollment count
    await EnhancedCourse.findByIdAndUpdate(courseId, {
      $inc: { enrollmentCount: 1 },
    });

    // Send notification to course author
    const notification = new Notification({
      recipient: {
        _id: course.author._id,
        email: course.author.email,
      },
      sender: {
        _id: userDetails._id,
        email: userDetails.email,
        name: userDetails.name,
        picture: userDetails.picture,
      },
      type: "course",
      content: `${userDetails.name} enrolled in your course: ${course.title}`,
      metadata: {
        itemId: courseId,
        itemType: "course",
        enrollmentId: enrollment._id.toString(),
      },
    });

    await notification.save();

    // Send FCM notification
    try {
      await FCMHandler.sendToUser(course.author._id, {
        title: "New Course Enrollment",
        body: `${userDetails.name} enrolled in ${course.title}`,
        type: "course_enrollment",
        data: {
          courseId: courseId,
          enrollmentId: enrollment._id.toString(),
        },
      });
    } catch (fcmError) {
      console.error("Failed to send FCM notification:", fcmError);
    }

    return res.status(201).json(
      GenRes(
        201,
        {
          enrollment: enrollment.toObject(),
          message: isFree
            ? "Successfully enrolled in free course"
            : "Enrollment completed with payment",
        },
        null,
        "Course enrollment successful"
      )
    );
  } catch (error) {
    console.error("Error enrolling in course:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update progress for a specific item (lesson, video, note)
const UpdateProgress = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { itemId, itemType, completed, timeSpent } = req.body;
    const user = req.user;

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

    const enrollment = await Enrollment.findOne({
      _id: enrollmentId,
      "student._id": user._id,
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

    // Find existing progress item or create new one
    let progressItem = enrollment.progress.itemsProgress.find(
      (item) => item.itemId === itemId && item.itemType === itemType
    );

    if (progressItem) {
      // Update existing progress
      progressItem.completed = completed;
      progressItem.timeSpent += timeSpent || 0;
      progressItem.lastAccessedAt = new Date();
      if (completed && !progressItem.completedAt) {
        progressItem.completedAt = new Date();
      }
    } else {
      // Create new progress item
      progressItem = {
        itemId,
        itemType,
        completed,
        timeSpent: timeSpent || 0,
        lastAccessedAt: new Date(),
        completedAt: completed ? new Date() : null,
      };
      enrollment.progress.itemsProgress.push(progressItem);
    }

    // Update overall progress counters
    const completedLessons = enrollment.progress.itemsProgress.filter(
      (item) => item.itemType === "lesson" && item.completed
    ).length;
    const completedVideos = enrollment.progress.itemsProgress.filter(
      (item) => item.itemType === "video" && item.completed
    ).length;
    const completedNotes = enrollment.progress.itemsProgress.filter(
      (item) => item.itemType === "note" && item.completed
    ).length;

    enrollment.progress.completedLessons = completedLessons;
    enrollment.progress.completedVideos = completedVideos;
    enrollment.progress.completedNotes = completedNotes;
    enrollment.progress.totalTimeSpent += timeSpent || 0;
    enrollment.progress.lastAccessedAt = new Date();

    await enrollment.save();

    // Check if course is completed and issue certificate
    if (
      enrollment.completion.isCompleted &&
      !enrollment.completion.certificateIssued
    ) {
      await issueCertificate(enrollment);
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          progress: enrollment.progress,
          overallProgress: enrollment.overallProgress,
          isCompleted: enrollment.completion.isCompleted,
        },
        null,
        "Progress updated successfully"
      )
    );
  } catch (error) {
    console.error("Error updating progress:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's enrollments
const GetUserEnrollments = async (req, res) => {
  try {
    const { status, page = 0, limit = 10 } = req.query;
    const user = req.user;

    const pageNum = parseInt(page, 10) || 0;
    const limitNum = Math.min(parseInt(limit, 10) || 10, 50);

    const filters = { "student._id": user._id };
    if (status) {
      filters.status = status;
    }

    const [enrollments, total] = await Promise.all([
      Enrollment.find(filters)
        .sort({ enrollmentDate: -1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      Enrollment.countDocuments(filters),
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          enrollments,
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

// Get enrollment analytics (Fixed version)
const GetEnrollmentAnalytics = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id;

    // Verify user is the course author or admin
    const course = await EnhancedCourse.findById(courseId).select(
      "author title"
    );
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

    // Get completion rate over time
    const completionTrends = await Enrollment.aggregate([
      {
        $match: {
          "course._id": courseId,
          "completion.isCompleted": true,
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$completion.completedAt" },
            month: { $month: "$completion.completedAt" },
          },
          completions: { $sum: 1 },
          averageTimeToComplete: {
            $avg: {
              $divide: [
                { $subtract: ["$completion.completedAt", "$enrollmentDate"] },
                1000 * 60 * 60 * 24, // Convert to days
              ],
            },
          },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          course: {
            id: courseId,
            title: course.title,
          },
          analytics: analytics[0] || {
            totalEnrollments: 0,
            freeEnrollments: 0,
            paidEnrollments: 0,
            activeEnrollments: 0,
            completedEnrollments: 0,
            averageProgress: 0,
            totalRevenue: 0,
            averageRating: 0,
            totalTimeSpent: 0,
          },
          enrollmentTrends,
          completionTrends,
        },
        null,
        "Course analytics retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error getting enrollment analytics:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get course progress for a specific enrollment
const GetCourseProgress = async (req, res) => {
  try {
    const { courseId } = req.params;
    const user = req.user;

    const enrollment = await Enrollment.findOne({
      "student._id": user._id,
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

    // Get course details for structure
    const course = await EnhancedCourse.findById(courseId)
      .select("lessons videos notes")
      .lean();

    // Organize progress by lessons
    const progressByLesson = {};

    // General content (not associated with lessons)
    progressByLesson.general = {
      videos: [],
      notes: [],
    };

    // Progress for each lesson
    course.lessons?.forEach((lesson) => {
      progressByLesson[lesson._id.toString()] = {
        lesson: lesson,
        videos: [],
        notes: [],
        completed: false,
      };
    });

    // Map progress items to lessons
    enrollment.progress.itemsProgress.forEach((item) => {
      if (item.itemType === "lesson") {
        const lessonProgress = progressByLesson[item.itemId];
        if (lessonProgress) {
          lessonProgress.completed = item.completed;
        }
      } else if (item.itemType === "video") {
        const video = course.videos?.find(
          (v) => v._id.toString() === item.itemId
        );
        if (video) {
          const lessonId = video.lessonId?.toString() || "general";
          const target = progressByLesson[lessonId] || progressByLesson.general;
          target.videos.push({
            ...video,
            progress: item,
          });
        }
      } else if (item.itemType === "note") {
        const note = course.notes?.find(
          (n) => n._id.toString() === item.itemId
        );
        if (note) {
          const lessonId = note.lessonId?.toString() || "general";
          const target = progressByLesson[lessonId] || progressByLesson.general;
          target.notes.push({
            ...note,
            progress: item,
          });
        }
      }
    });

    return res.status(200).json(
      GenRes(
        200,
        {
          enrollment: {
            _id: enrollment._id,
            status: enrollment.status,
            enrollmentDate: enrollment.enrollmentDate,
            progress: enrollment.progress,
            completion: enrollment.completion,
          },
          progressByLesson,
          overallProgress: enrollment.overallProgress || 0,
        },
        null,
        "Course progress retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error getting course progress:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Issue certificate for completed course
const issueCertificate = async (enrollment) => {
  try {
    // Get course details
    const course = await EnhancedCourse.findById(enrollment.course._id).lean();
    if (!course) return;

    // Create certificate record in database
    const certificate = new Certificate({
      student: enrollment.student,
      course: {
        _id: course._id,
        title: course.title,
        instructor: course.instructor,
        duration: course.duration,
        level: course.level,
      },
      enrollment: {
        _id: enrollment._id,
        enrollmentDate: enrollment.enrollmentDate,
        completionDate: enrollment.completion.completedAt,
        finalScore: enrollment.completion.finalScore,
        timeSpent: Math.round(enrollment.progress.totalTimeSpent / 3600), // Convert to hours
      },
    });

    await certificate.save();

    // Prepare certificate data
    const certificateData = {
      certificateId: certificate.certificateId,
      studentName: enrollment.student.name,
      courseName: course.title,
      completionDate: enrollment.completion.completedAt,
      instructor: course.instructor,
      verificationCode: certificate.certificate.verificationCode,
      timeSpent: Math.round(enrollment.progress.totalTimeSpent / 3600), // Convert to hours
      issuer: certificate.metadata.issuer.name,
    };

    // Create certificate directory structure similar to multer
    const certificateDir = path.join(
      process.cwd(),
      "certificates",
      "generated",
      "course",
      enrollment.student._id
    );

    // Generate and save the certificate HTML file
    const certificateResult = await CertificateGenerator.saveCertificateFile(
      certificateData,
      certificateDir,
      "course"
    );

    if (certificateResult.success) {
      // Update certificate record with file URLs
      certificate.certificate.certificateUrl = certificateResult.url;
      certificate.certificate.downloadUrl = certificateResult.url;
      await certificate.save();

      // Update enrollment with certificate info
      enrollment.completion.certificateIssued = true;
      enrollment.completion.certificateId = certificate.certificateId;
      enrollment.completion.certificateUrl = certificateResult.url;
      await enrollment.save();

      console.log(
        `Certificate generated successfully: ${certificateResult.filepath}`
      );
    } else {
      console.error(
        `Failed to generate certificate file: ${certificateResult.error}`
      );
      // Still update enrollment even if file generation fails
      enrollment.completion.certificateIssued = true;
      enrollment.completion.certificateId = certificate.certificateId;
      enrollment.completion.certificateUrl =
        CertificateGenerator.getCertificateUrl(
          certificate.certificateId,
          "course"
        );
      await enrollment.save();
    }

    // Send notification to student
    const notification = new Notification({
      recipient: {
        _id: enrollment.student._id,
        email: enrollment.student.email,
      },
      sender: {
        _id: "system",
        email: "system@platform.com",
        name: "System",
      },
      type: "course",
      content: `Congratulations! You've completed ${course.title} and earned a certificate.`,
      metadata: {
        itemId: course._id.toString(),
        itemType: "certificate",
        certificateId: certificate.certificateId,
        certificateUrl: certificate.certificate.certificateUrl,
        verificationCode: certificate.certificate.verificationCode,
      },
    });

    await notification.save();

    // Send FCM notification
    try {
      await FCMHandler.sendToUser(enrollment.student._id, {
        title: "Certificate Earned! 🎉",
        body: `Congratulations! You've completed ${course.title}`,
        type: "certificate_earned",
        data: {
          courseId: course._id.toString(),
          certificateId: certificate.certificateId,
          certificateUrl: certificate.certificate.certificateUrl,
          verificationUrl: certificate.verification.verificationUrl,
        },
      });
    } catch (fcmError) {
      console.error("Failed to send certificate FCM notification:", fcmError);
    }

    console.log(
      `Certificate issued for ${enrollment.student.name} - Course: ${course.title} - Certificate ID: ${certificate.certificateId}`
    );

    return certificate;
  } catch (error) {
    console.error("Error issuing certificate:", error);
    throw error;
  }
};

// Get user's certificates
const GetUserCertificates = async (req, res) => {
  try {
    const user = req.user;

    const certificates = await Certificate.find({
      "student._id": user._id,
    })
      .sort({ "certificate.issuedAt": -1 })
      .lean();

    // Add view URLs for each certificate
    const certificatesWithUrls = certificates.map((cert) => ({
      ...cert,
      viewUrl: CertificateGenerator.getCertificateUrl(
        cert.certificateId,
        "course"
      ),
      verificationUrl: CertificateGenerator.getVerificationUrl(
        cert.certificate.verificationCode
      ),
      fileExists: CertificateGenerator.certificateExists(
        cert.certificateId,
        "course"
      ),
    }));

    return res
      .status(200)
      .json(
        GenRes(
          200,
          certificatesWithUrls,
          null,
          `Retrieved ${certificates.length} certificates`
        )
      );
  } catch (error) {
    console.error("Error getting user certificates:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Verify certificate
const VerifyCertificate = async (req, res) => {
  try {
    const { verificationCode } = req.params;

    const certificate = await Certificate.findOne({
      "certificate.verificationCode": verificationCode,
    }).lean();

    if (!certificate) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Certificate not found" },
            "Invalid verification code"
          )
        );
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          isValid: true,
          certificate: {
            certificateId: certificate.certificateId,
            studentName: certificate.student.name,
            courseName: certificate.course.title,
            completionDate: certificate.enrollment.completionDate,
            issuedAt: certificate.certificate.issuedAt,
            instructor: certificate.course.instructor,
            timeSpent: certificate.enrollment.timeSpent,
            level: certificate.course.level,
            duration: certificate.course.duration,
            verificationUrl: certificate.verification.verificationUrl,
            certificateUrl: certificate.certificate.certificateUrl,
          },
        },
        null,
        "Certificate verified successfully"
      )
    );
  } catch (error) {
    console.error("Error verifying certificate:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Download certificate
const DownloadCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;
    const user = req.user;

    // Find certificate and verify ownership
    const certificate = await Certificate.findOne({
      certificateId,
      "student._id": user._id,
    }).lean();

    if (!certificate) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Certificate not found" },
            "Certificate not found or access denied"
          )
        );
    }

    // Check if certificate file exists
    const fileExists = CertificateGenerator.certificateExists(
      certificateId,
      "course"
    );

    if (!fileExists) {
      // Try to regenerate the certificate if file is missing
      console.log(
        `Certificate file missing for ${certificateId}, attempting to regenerate...`
      );

      const certificateData = {
        certificateId: certificate.certificateId,
        studentName: certificate.student.name,
        courseName: certificate.course.title,
        completionDate: certificate.enrollment.completionDate,
        instructor: certificate.course.instructor,
        verificationCode: certificate.certificate.verificationCode,
        timeSpent: certificate.enrollment.timeSpent,
        issuer: certificate.metadata.issuer.name,
      };

      const certificateDir = path.join(
        process.cwd(),
        "certificates",
        "generated",
        "course",
        user._id
      );

      const regenerateResult = await CertificateGenerator.saveCertificateFile(
        certificateData,
        certificateDir,
        "course"
      );

      if (!regenerateResult.success) {
        return res
          .status(500)
          .json(
            GenRes(
              500,
              null,
              { error: "Certificate file not available" },
              "Certificate file could not be generated"
            )
          );
      }
    }

    // Return download URL
    return res.status(200).json(
      GenRes(
        200,
        {
          certificateId: certificate.certificateId,
          downloadUrl:
            certificate.certificate.downloadUrl ||
            CertificateGenerator.getCertificateUrl(certificateId, "course"),
          fileName: `${certificate.course.title.replace(
            /[^a-zA-Z0-9]/g,
            "_"
          )}_Certificate.html`,
          fileExists: true,
        },
        null,
        "Certificate download link generated"
      )
    );
  } catch (error) {
    console.error("Error downloading certificate:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Regenerate certificate
const RegenerateCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params;
    const user = req.user;

    // Find certificate and verify ownership
    const certificate = await Certificate.findOne({
      certificateId,
      "student._id": user._id,
    });

    if (!certificate) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Certificate not found" },
            "Certificate not found or access denied"
          )
        );
    }

    // Regenerate certificate file
    const certificateData = {
      certificateId: certificate.certificateId,
      studentName: certificate.student.name,
      courseName: certificate.course.title,
      completionDate: certificate.enrollment.completionDate,
      instructor: certificate.course.instructor,
      verificationCode: certificate.certificate.verificationCode,
      timeSpent: certificate.enrollment.timeSpent,
      issuer: certificate.metadata.issuer.name,
    };

    const certificateDir = path.join(
      process.cwd(),
      "certificates",
      "generated",
      "course",
      user._id
    );

    const certificateResult = await CertificateGenerator.saveCertificateFile(
      certificateData,
      certificateDir,
      "course"
    );

    if (certificateResult.success) {
      // Update certificate record with new file URL
      certificate.certificate.certificateUrl = certificateResult.url;
      certificate.certificate.downloadUrl = certificateResult.downloadUrl;
      await certificate.save();

      return res.status(200).json(
        GenRes(
          200,
          {
            certificateId: certificate.certificateId,
            certificateUrl: certificateResult.downloadUrl,
            message: "Certificate regenerated successfully",
          },
          null,
          "Certificate regenerated successfully"
        )
      );
    } else {
      return res
        .status(500)
        .json(
          GenRes(
            500,
            null,
            { error: "Generation failed", details: certificateResult.error },
            "Failed to regenerate certificate"
          )
        );
    }
  } catch (error) {
    console.error("Error regenerating certificate:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  EnrollInCourse,
  UpdateProgress,
  GetUserEnrollments,
  GetEnrollmentAnalytics,
  GetCourseProgress,
  GetUserCertificates,
  VerifyCertificate,
  DownloadCertificate,
  RegenerateCertificate,
};
