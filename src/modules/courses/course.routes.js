const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const AdminFiles = require("../../utils/fileProcessor/multer.courses");

// Import methods
const {
  GetCategories,
  GetCoursesByCategory,
  GetCourseDetails,
} = require("./course.methods");

const {
  CreateCategory,
  UpdateCategory,
  DeleteCategory,
  CreateCourse,
  UpdateCourse,
  DeleteCourse,
  AddLesson,
  UpdateLesson,
  DeleteLesson,
  AddLessonContent,
  UpdateLessonContent,
  DeleteLessonContent,
  AddCourseVideo,
  AddCoursePDF,
} = require("./admin.methods");

// ==================== PUBLIC ROUTES ====================

// Get all categories
router.get("/categories", GetCategories);

// Get courses by category
router.get("/category/:categoryId/courses", GetCoursesByCategory);

// Get course details with lessons
router.get("/courses/:courseId", basicMiddleware, GetCourseDetails);

// ==================== ADMIN CATEGORY MANAGEMENT ====================

// Create category
router.post("/admin/categories", basicMiddleware, CreateCategory);

// Update category
router.put("/admin/categories/:categoryId", basicMiddleware, UpdateCategory);

// Delete category
router.delete("/admin/categories/:categoryId", basicMiddleware, DeleteCategory);

// ==================== ADMIN COURSE MANAGEMENT ====================

// Create course
router.post(
  "/admin/courses",
  basicMiddleware,
  AdminFiles("public").fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "overviewVideo", maxCount: 1 },
  ]),
  CreateCourse
);

// Update course
router.put(
  "/admin/courses/:courseId",
  basicMiddleware,
  AdminFiles("public").fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "overviewVideo", maxCount: 1 },
  ]),
  UpdateCourse
);

// Delete course
router.delete("/admin/courses/:courseId", basicMiddleware, DeleteCourse);

// ==================== LESSON MANAGEMENT ====================

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

// Add content (notes/videos) to lesson
router.post(
  "/admin/courses/:courseId/lessons/:lessonId/content",
  basicMiddleware,
  AdminFiles("public").any(),
  AddLessonContent
);

// Update lesson content (video or note)
router.put(
  "/admin/courses/:courseId/lessons/:lessonId/content/:contentId",
  basicMiddleware,
  AdminFiles("public").any(),
  UpdateLessonContent
);

// Delete content from lesson
router.delete(
  "/admin/courses/:courseId/lessons/:lessonId/content/:contentId",
  basicMiddleware,
  DeleteLessonContent
);

// ==================== COURSE CONTENT MANAGEMENT ====================

// Add video directly to course (not lesson-specific)
router.post(
  "/admin/courses/:courseId/videos",
  basicMiddleware,
  AdminFiles("public").fields([
    { name: "video", maxCount: 5 },
    { name: "thumbnail", maxCount: 5 },
  ]),
  AddCourseVideo
);

// Add PDF directly to course (not lesson-specific)
router.post(
  "/admin/courses/:courseId/pdfs",
  basicMiddleware,
  AdminFiles("public").any(),
  AddCoursePDF
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
