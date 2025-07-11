const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const {
  checkSubcategoryEnrollment,
  checkDownloadPermission,
  optionalEnrollmentCheck,
} = require("../../middlewares/enrollmentMiddleware");

const {
  EnrollInSubcategory,
  UpdateEnrollmentInfo,
  CancelEnrollment,
  GetUserEnrollments,
  GetEnrollmentDetails,
  CheckEnrollmentAccess,
  SubmitSubcategoryFeedback,
  AddPersonalNote,
} = require("./subcategory.enrollment.methods");

// Import progress methods
const {
  UpdateCourseProgressInEnrollment,
  GetEnrollmentProgress,
  GetCourseContentForEnrolled,
} = require("./enrollment.progress.methods");

// ==================== ENROLLMENT MANAGEMENT ====================

// Enroll in subcategory
router.post(
  "/subcategories/:subcategoryId/enroll",
  basicMiddleware,
  EnrollInSubcategory
);

// Update enrollment information
router.put(
  "/enrollments/:enrollmentId/info",
  basicMiddleware,
  UpdateEnrollmentInfo
);

// Cancel enrollment
router.post(
  "/enrollments/:enrollmentId/cancel",
  basicMiddleware,
  CancelEnrollment
);

// Get user's enrollments
router.get("/my-enrollments", basicMiddleware, GetUserEnrollments);

// Get enrollment details
router.get("/enrollments/:enrollmentId", basicMiddleware, GetEnrollmentDetails);

// Check enrollment access
router.get(
  "/subcategories/:subcategoryId/access",
  basicMiddleware,
  CheckEnrollmentAccess
);

// ==================== PROGRESS TRACKING ====================

// Update course progress within enrollment
router.post(
  "/enrollments/:enrollmentId/courses/:courseId/progress",
  basicMiddleware,
  UpdateCourseProgressInEnrollment
);

// Get enrollment progress
router.get(
  "/enrollments/:enrollmentId/progress",
  basicMiddleware,
  GetEnrollmentProgress
);

// ==================== CONTENT ACCESS (PROTECTED) ====================

// Get course content (requires enrollment)
router.get(
  "/enrolled/courses/:courseId/content",
  basicMiddleware,
  checkSubcategoryEnrollment,
  GetCourseContentForEnrolled
);

// Access course notes (requires enrollment and notes permission)
router.get(
  "/enrolled/courses/:courseId/notes/:noteId",
  basicMiddleware,
  checkSubcategoryEnrollment,
  (req, res) => {
    // This would serve the actual note file
    // Implementation depends on your file serving setup
    res.json({ message: "Note access granted", noteId: req.params.noteId });
  }
);

// Access course videos (requires enrollment and video permission)
router.get(
  "/enrolled/courses/:courseId/videos/:videoId",
  basicMiddleware,
  checkSubcategoryEnrollment,
  (req, res) => {
    // This would serve the actual video file
    // Implementation depends on your video streaming setup
    res.json({ message: "Video access granted", videoId: req.params.videoId });
  }
);

// Download content (requires enrollment and download permission)
router.get(
  "/enrolled/courses/:courseId/download/:contentId",
  basicMiddleware,
  checkSubcategoryEnrollment,
  checkDownloadPermission,
  (req, res) => {
    // This would handle file downloads
    res.json({
      message: "Download access granted",
      contentId: req.params.contentId,
      downloadUrl: `/api/v1/download/${req.params.contentId}`,
    });
  }
);

// ==================== FEEDBACK AND NOTES ====================

// Submit subcategory feedback
router.post(
  "/enrollments/:enrollmentId/feedback",
  basicMiddleware,
  SubmitSubcategoryFeedback
);

// Add personal note
router.post(
  "/enrollments/:enrollmentId/notes",
  basicMiddleware,
  AddPersonalNote
);

// Get personal notes
router.get(
  "/enrollments/:enrollmentId/notes",
  basicMiddleware,
  async (req, res) => {
    try {
      const { enrollmentId } = req.params;
      const userId = req.user._id;
      const SubcategoryEnrollment = require("./subcategory.enrollment.model");

      const enrollment = await SubcategoryEnrollment.findOne({
        _id: enrollmentId,
        "student._id": userId,
      }).select("personalNotes");

      if (!enrollment) {
        return res.status(404).json({
          status: 404,
          data: null,
          error: { message: "Enrollment not found" },
          message: "Enrollment not found",
        });
      }

      res.status(200).json({
        status: 200,
        data: enrollment.personalNotes,
        error: null,
        message: "Personal notes retrieved successfully",
      });
    } catch (error) {
      res.status(500).json({
        status: 500,
        data: null,
        error: { message: error.message },
        message: "Internal server error",
      });
    }
  }
);

module.exports = router;
