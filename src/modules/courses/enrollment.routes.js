const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const {
  EnrollInCourse,
  GetUserEnrollments,
  CheckCourseEnrollment,
  GetEnrollmentsBySubcategory,
  UpdateCourseProgress,
  GetCourseProgress,
  AddPersonalNote,
  SubmitCourseFeedback,
  GetEnrollmentAnalytics,
} = require("./enrollment.methods");

// Course enrollment routes
router.post("/courses/:courseId/enroll", basicMiddleware, EnrollInCourse);
router.get(
  "/courses/:courseId/enrollment-status",
  basicMiddleware,
  CheckCourseEnrollment
);

// User enrollment management
router.get("/my-enrollments", basicMiddleware, GetUserEnrollments);
router.get("/courses/:courseId/progress", basicMiddleware, GetCourseProgress);
router.post(
  "/courses/:courseId/progress",
  basicMiddleware,
  UpdateCourseProgress
);

// Personal notes for enrolled courses
router.post("/courses/:courseId/notes", basicMiddleware, AddPersonalNote);

// Course feedback for enrolled courses
router.post(
  "/courses/:courseId/feedback",
  basicMiddleware,
  SubmitCourseFeedback
);

// Analytics routes
router.get(
  "/subcategories/:subcategoryId/enrollments",
  basicMiddleware,
  GetEnrollmentsBySubcategory
);
router.get(
  "/courses/:courseId/analytics",
  basicMiddleware,
  GetEnrollmentAnalytics
);

module.exports = router;
