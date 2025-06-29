const basicMiddleware = require("../../middlewares/basicMiddleware");
const AdminFiles = require("../../utils/fileProcessor/multer.courses");
const { AddCourse, DelCourses } = require("./course.admin.methods");
const { MultipleFiles, DeleteFiles } = require("./course.file");
const ListCourses = require("./courses.list");
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
route.delete("/delete-courses/:id", basicMiddleware, DelCourses);

// List courses
route.get("/list-courses", basicMiddleware, ListCourses);
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

module.exports = route;
