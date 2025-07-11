const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const {
  EnrollInCourse,
  UpdateProgress,
  GetUserEnrollments,
  GetEnrollmentAnalytics,
  GetCourseProgress,
  GetUserCertificates,
  VerifyCertificate,
  DownloadCertificate,
  RegenerateCertificate,
} = require("./enrollment.methods");

// Public certificate verification (no auth required)
router.get("/verify-certificate/:verificationCode", VerifyCertificate);

// Enrollment routes
router.post("/courses/:courseId/enroll", basicMiddleware, EnrollInCourse);
router.get("/my-enrollments", basicMiddleware, GetUserEnrollments);
router.get("/courses/:courseId/progress", basicMiddleware, GetCourseProgress);

// Progress tracking
router.post(
  "/enrollments/:enrollmentId/progress",
  basicMiddleware,
  UpdateProgress
);

// Certificate management routes
router.get("/my-certificates", basicMiddleware, GetUserCertificates);
router.get(
  "/certificates/:certificateId/download",
  basicMiddleware,
  DownloadCertificate
);
router.post(
  "/certificates/:certificateId/regenerate",
  basicMiddleware,
  RegenerateCertificate
);

// Analytics (for course authors and admins)
router.get(
  "/courses/:courseId/analytics",
  basicMiddleware,
  GetEnrollmentAnalytics
);

module.exports = router;
