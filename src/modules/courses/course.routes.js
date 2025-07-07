// const basicMiddleware = require("../../middlewares/basicMiddleware");
// const AdminFiles = require("../../utils/fileProcessor/multer.courses");
// const {
//   AddCourse,
//   DelCourses,
//   AddLessonToCourse,
//   AddNoteToCourse,
//   AddVideoToCourse,
// } = require("./course.admin.methods");
// const { MultipleFiles, DeleteFiles } = require("./course.file");
// const { ListCourses, GetCourseById } = require("./courses.list");
// const { UpdateCourse } = require("./course.update.methods");
// const {
//   GetCoursePDFs,
//   GetCourseVideos,
//   DownloadPDF,
//   DownloadVideo,
// } = require("./course.content.methods");
// const {
//   CreateCourseCategory,
//   GetCourseCategories,
//   GetCoursesByCategory,
//   UpdateCourseCategory,
//   DeleteCourseCategory,
//   GetCategoryHierarchy,
// } = require("./course.category.methods");
// const {
//   GetParentCategories,
//   GetSubcategories,
//   GetSubcategoryCourses,
//   GetCourseWithLessons,
//   GetNotesByParentCategory,
//   GetCategoryHierarchy: GetHierarchy,
// } = require("./course.hierarchy.methods");
// const {
//   EnrollInCourse,
//   GetUserEnrollments,
//   UpdateCourseProgress,
//   GetCourseProgress,
//   AddPersonalNote,
//   SubmitCourseFeedback,
//   GetEnrollmentAnalytics,
// } = require("./enrollment.methods");

// const {
//   SubmitCourseRating,
//   GetCourseRatings,
//   MarkRatingHelpful,
//   GetUserCourseRating,
//   DeleteCourseRating,
// } = require("./rating.methods");

// const route = require("express").Router();

// // Course Category Management (Admin only)
// route.post("/admin/course-categories", basicMiddleware, CreateCourseCategory);
// route.get("/course-categories", GetCourseCategories);
// route.get("/course-categories/hierarchy", GetCategoryHierarchy);
// route.get(
//   "/course-categories/:categoryId/courses",
//   basicMiddleware,
//   GetCoursesByCategory
// );
// route.put(
//   "/admin/course-categories/:categoryId",
//   basicMiddleware,
//   UpdateCourseCategory
// );
// route.delete(
//   "/admin/course-categories/:categoryId",
//   basicMiddleware,
//   DeleteCourseCategory
// );

// // New Hierarchy Routes
// route.get("/parent-categories", GetParentCategories);
// route.get("/parent-categories/:parentId/subcategories", GetSubcategories);
// route.get("/subcategories/:subcategoryId/courses", GetSubcategoryCourses);
// route.get("/courses/:courseId/lessons", basicMiddleware, GetCourseWithLessons);
// route.get("/parent-categories/:parentId/notes", GetNotesByParentCategory);
// route.get("/hierarchy", GetHierarchy);

// // File uploads
// route.post(
//   "/add-public-course-file",
//   basicMiddleware,
//   AdminFiles("public").any(),
//   MultipleFiles
// );
// route.post(
//   "/add-private-course-file",
//   basicMiddleware,
//   AdminFiles("private").any(),
//   MultipleFiles
// );

// route.delete("/delete-course-files", basicMiddleware, DeleteFiles);

// // Course management
// route.post("/add-course", basicMiddleware, AddCourse);
// route.put("/update-course/:id", basicMiddleware, UpdateCourse);
// route.delete("/delete-courses/:id", basicMiddleware, DelCourses);

// // Course content management
// route.post("/courses/:courseId/lessons", basicMiddleware, AddLessonToCourse);
// route.post("/courses/:courseId/notes", basicMiddleware, AddNoteToCourse);
// route.post("/courses/:courseId/videos", basicMiddleware, AddVideoToCourse);

// // Course enrollment routes
// route.post("/courses/:courseId/enroll", basicMiddleware, EnrollInCourse);
// route.get("/my-enrollments", basicMiddleware, GetUserEnrollments);

// // Course progress tracking routes
// route.post(
//   "/courses/:courseId/progress",
//   basicMiddleware,
//   UpdateCourseProgress
// );
// route.get("/courses/:courseId/progress", basicMiddleware, GetCourseProgress);

// // Course feedback and rating
// route.post(
//   "/courses/:courseId/feedback",
//   basicMiddleware,
//   SubmitCourseFeedback
// );

// // Course analytics
// route.get(
//   "/courses/:courseId/analytics",
//   basicMiddleware,
//   GetEnrollmentAnalytics
// );

// // Personal notes for courses
// route.post("/courses/:courseId/notes", basicMiddleware, AddPersonalNote);

// // List courses
// route.get("/list-courses", basicMiddleware, ListCourses);

// // Get single course by ID
// route.get("/course/:id", basicMiddleware, GetCourseById);

// route.get("/admin-list-courses/:page", basicMiddleware, ListCourses);

// // Course content routes - PDFs and Videos separately
// route.get("/courses/:courseId/pdfs", basicMiddleware, GetCoursePDFs);
// route.get("/courses/:courseId/videos", basicMiddleware, GetCourseVideos);

// // Download routes
// route.get(
//   "/courses/download-pdf/:courseId/:noteId",
//   basicMiddleware,
//   DownloadPDF
// );
// route.get(
//   "/courses/download-video/:courseId/:noteId",
//   basicMiddleware,
//   DownloadVideo
// );

// // Course rating and review system
// route.post("/courses/:courseId/rating", basicMiddleware, SubmitCourseRating);
// route.get("/courses/:courseId/ratings", basicMiddleware, GetCourseRatings);
// route.get("/courses/:courseId/my-rating", basicMiddleware, GetUserCourseRating);
// route.delete("/courses/:courseId/rating", basicMiddleware, DeleteCourseRating);
// route.post("/ratings/:ratingId/helpful", basicMiddleware, MarkRatingHelpful);

// module.exports = route;

const basicMiddleware = require("../../middlewares/basicMiddleware");
const AdminFiles = require("../../utils/fileProcessor/multer.courses");

// Import management functions
const {
  // Category Management
  CreateParentCategory,
  CreateSubcategory,
  UpdateCategory,
  DeleteCategory,

  // Course Management
  CreateCourse,
  UpdateCourse,
  DeleteCourse,

  // Lesson Management
  AddLesson,
  UpdateLesson,
  DeleteLesson,

  // Note Management
  AddNote,
  UpdateNote,
  DeleteNote,

  // Video Management
  AddVideo,
  UpdateVideo,
  DeleteVideo,

  // Overview Video Management
  UpdateOverviewVideo,
  DeleteOverviewVideo,
} = require("./admin.course.management");

// Import display functions
const {
  GetParentCategories,
  GetSubcategories,
  GetSubcategoryCourses,
  GetCourseWithLessons,
  GetNotesByParentCategory,
  GetCategoryHierarchy,
} = require("./course.hierarchy.display");

const router = require("express").Router();

// ==================== PUBLIC DISPLAY ROUTES ====================

// Get parent categories for main navigation
router.get("/parent-categories", GetParentCategories);

// Get subcategories under a parent (for Courses tab)
router.get("/parent-categories/:parentId/subcategories", GetSubcategories);

// Get courses under a subcategory
router.get("/subcategories/:subcategoryId/courses", GetSubcategoryCourses);

// Get course details with lessons (when lesson is selected, filter content)
router.get("/courses/:courseId/lessons", basicMiddleware, GetCourseWithLessons);

// Get notes by parent category (for Notes tab)
router.get("/parent-categories/:parentId/notes", GetNotesByParentCategory);

// Get complete category hierarchy
router.get("/hierarchy", GetCategoryHierarchy);

// ==================== ADMIN CATEGORY MANAGEMENT ====================

// Create parent category
router.post("/admin/parent-categories", basicMiddleware, CreateParentCategory);

// Create subcategory
router.post("/admin/subcategories", basicMiddleware, CreateSubcategory);

// Update category (parent or subcategory)
router.put("/admin/categories/:categoryId", basicMiddleware, UpdateCategory);

// Delete category (parent or subcategory)
router.delete("/admin/categories/:categoryId", basicMiddleware, DeleteCategory);

// ==================== ADMIN COURSE MANAGEMENT ====================

// Create course
router.post("/admin/courses", basicMiddleware, CreateCourse);

// Update course
router.put("/admin/courses/:courseId", basicMiddleware, UpdateCourse);

// Delete course
router.delete("/admin/courses/:courseId", basicMiddleware, DeleteCourse);

// Update overview video
router.put(
  "/admin/courses/:courseId/overview-video",
  basicMiddleware,
  UpdateOverviewVideo
);

// Delete overview video
router.delete(
  "/admin/courses/:courseId/overview-video",
  basicMiddleware,
  DeleteOverviewVideo
);

// ==================== ADMIN LESSON MANAGEMENT ====================

// Add lesson to course
router.post("/admin/courses/:courseId/lessons", basicMiddleware, AddLesson);

// Update lesson
router.put(
  "/admin/courses/:courseId/lessons/:lessonId",
  basicMiddleware,
  UpdateLesson
);

// Delete lesson
router.delete(
  "/admin/courses/:courseId/lessons/:lessonId",
  basicMiddleware,
  DeleteLesson
);

// ==================== ADMIN NOTE MANAGEMENT ====================

// Add note to course (with optional lesson association)
router.post("/admin/courses/:courseId/notes", basicMiddleware, AddNote);

// Update note
router.put(
  "/admin/courses/:courseId/notes/:noteId",
  basicMiddleware,
  UpdateNote
);

// Delete note
router.delete(
  "/admin/courses/:courseId/notes/:noteId",
  basicMiddleware,
  DeleteNote
);

// ==================== ADMIN VIDEO MANAGEMENT ====================

// Add video to course (with optional lesson association)
router.post("/admin/courses/:courseId/videos", basicMiddleware, AddVideo);

// Update video
router.put(
  "/admin/courses/:courseId/videos/:videoId",
  basicMiddleware,
  UpdateVideo
);

// Delete video
router.delete(
  "/admin/courses/:courseId/videos/:videoId",
  basicMiddleware,
  DeleteVideo
);

// ==================== FILE UPLOAD ROUTES ====================

// Upload course files (public)
router.post(
  "/admin/upload-public-files",
  basicMiddleware,
  AdminFiles("public").any(),
  (req, res) => {
    const GenRes = require("../../utils/routers/GenRes");
    const file_locations = req?.file_locations;
    return res
      .status(200)
      .json(GenRes(200, file_locations, null, "Files uploaded successfully!"));
  }
);

// Upload course files (private)
router.post(
  "/admin/upload-private-files",
  basicMiddleware,
  AdminFiles("private").any(),
  (req, res) => {
    const GenRes = require("../../utils/routers/GenRes");
    const file_locations = req?.file_locations;
    return res
      .status(200)
      .json(GenRes(200, file_locations, null, "Files uploaded successfully!"));
  }
);

// Delete course files
router.delete("/admin/delete-files", basicMiddleware, (req, res) => {
  const GenRes = require("../../utils/routers/GenRes");
  const path = require("path");
  const fs = require("fs");

  try {
    const filesList = req?.body;

    if (!filesList || !Array.isArray(filesList) || filesList.length === 0) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            new Error("Files location must be provided in array"),
            "Please provide location in valid format"
          )
        );
    }

    const failedFile = [];

    for (const file of filesList) {
      try {
        fs.unlinkSync(path.join(process.cwd(), file.slice(1)));
      } catch (error) {
        console.log(error?.message);
        failedFile.push(file);
      }
    }

    const response = GenRes(
      failedFile?.length > 0 ? 207 : 200,
      { failedFile },
      null,
      "Files Deleted"
    );

    return res.status(response?.status).json(response);
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
});

module.exports = router;
