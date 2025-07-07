const basicMiddleware = require("../../middlewares/basicMiddleware");
const AdminFiles = require("../../utils/fileProcessor/multer.courses");
const { AddCourse, DelCourses } = require("./course.admin.methods");
const { MultipleFiles, DeleteFiles } = require("./course.file");
const { ListCourses, GetCourseById } = require("./courses.list");
const { UpdateCourse } = require("./course.update.methods");
const {
  GetCoursePDFs,
  GetCourseVideos,
  DownloadPDF,
  DownloadVideo,
} = require("./course.content.methods");
const {
  CreateCourseCategory,
  GetCourseCategories,
  GetCoursesByCategory,
  UpdateCourseCategory,
  DeleteCourseCategory,
  GetCategoryHierarchy,
} = require("./course.category.methods"); 
const {
  EnrollInCourse,
  GetUserEnrollments,
  UpdateCourseProgress,
  GetCourseProgress,
  AddPersonalNote,
  SubmitCourseFeedback,
  GetEnrollmentAnalytics,
} = require("./enrollment.methods");

const {
  SubmitCourseRating,
  GetCourseRatings,
  MarkRatingHelpful,
  GetUserCourseRating,
  DeleteCourseRating,
} = require("./rating.methods");

const route = require("express").Router();

// Course Category Management (Admin only)
route.post("/admin/course-categories", basicMiddleware, CreateCourseCategory);
route.get("/course-categories", GetCourseCategories);
route.get("/course-categories/hierarchy", GetCategoryHierarchy);
route.get(
  "/course-categories/:categoryId/courses",
  basicMiddleware,
  GetCoursesByCategory
);
route.put(
  "/admin/course-categories/:categoryId",
  basicMiddleware,
  UpdateCourseCategory
);
route.delete(
  "/admin/course-categories/:categoryId",
  basicMiddleware,
  DeleteCourseCategory
);

// File uploads
route.post(
  "/add-public-course-file",
  basicMiddleware,
  AdminFiles("public").any(),
  MultipleFiles
);
route.post(
  "/add-private-course-file",
  basicMiddleware,
  AdminFiles("private").any(),
  MultipleFiles
);

route.delete("/delete-course-files", basicMiddleware, DeleteFiles);

// Course management
route.post("/add-course", basicMiddleware, AddCourse);
route.put("/update-course/:id", basicMiddleware, UpdateCourse);
route.delete("/delete-courses/:id", basicMiddleware, DelCourses);

// Course enrollment routes
route.post("/courses/:courseId/enroll", basicMiddleware, EnrollInCourse);
route.get("/my-enrollments", basicMiddleware, GetUserEnrollments);

// Course progress tracking routes
route.post(
  "/courses/:courseId/progress",
  basicMiddleware,
  UpdateCourseProgress
);
route.get("/courses/:courseId/progress", basicMiddleware, GetCourseProgress);

// Course feedback and rating
route.post(
  "/courses/:courseId/feedback",
  basicMiddleware,
  SubmitCourseFeedback
);

// Course analytics
route.get(
  "/courses/:courseId/analytics",
  basicMiddleware,
  GetEnrollmentAnalytics
);

// Personal notes for courses
route.post("/courses/:courseId/notes", basicMiddleware, AddPersonalNote);

// List courses
route.get("/list-courses", basicMiddleware, ListCourses);

// Get single course by ID
route.get("/course/:id", basicMiddleware, GetCourseById);

route.get("/admin-list-courses/:page", basicMiddleware, ListCourses);

// Course content routes - PDFs and Videos separately
route.get("/courses/:courseId/pdfs", basicMiddleware, GetCoursePDFs);
route.get("/courses/:courseId/videos", basicMiddleware, GetCourseVideos);

// Download routes
route.get(
  "/courses/download-pdf/:courseId/:noteId",
  basicMiddleware,
  DownloadPDF
);
route.get(
  "/courses/download-video/:courseId/:noteId",
  basicMiddleware,
  DownloadVideo
);

// Course rating and review system
route.post("/courses/:courseId/rating", basicMiddleware, SubmitCourseRating);
route.get("/courses/:courseId/ratings", basicMiddleware, GetCourseRatings);
route.get("/courses/:courseId/my-rating", basicMiddleware, GetUserCourseRating);
route.delete("/courses/:courseId/rating", basicMiddleware, DeleteCourseRating);
route.post("/ratings/:ratingId/helpful", basicMiddleware, MarkRatingHelpful);

module.exports = route;
