const basicMiddleware = require("../../middlewares/basicMiddleware");
const AdminFiles = require("../../utils/fileProcessor/multer.courses");

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
router.post(
  "/admin/courses",
  basicMiddleware,
  AdminFiles("public").fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "bannerImage", maxCount: 1 },
  ]),
  CreateCourse
);

// Update course
router.put(
  "/admin/courses/:courseId",
  basicMiddleware,
  AdminFiles("public").fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "bannerImage", maxCount: 1 },
  ]),
  UpdateCourse
);

// Delete course
router.delete("/admin/courses/:courseId", basicMiddleware, DeleteCourse);

// Update overview video
router.put(
  "/admin/courses/:courseId/overview-video",
  basicMiddleware,
  AdminFiles("private").single("overviewVideo"),
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
router.post(
  "/admin/courses/:courseId/notes",
  basicMiddleware,
  AdminFiles("private").single("noteFile"),
  AddNote
);

// Update note
router.put(
  "/admin/courses/:courseId/notes/:noteId",
  basicMiddleware,
  AdminFiles("private").single("noteFile"),
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
router.post(
  "/admin/courses/:courseId/videos",
  basicMiddleware,
  AdminFiles("private").single("videoFile"),
  AddVideo
);

// Update video
router.put(
  "/admin/courses/:courseId/videos/:videoId",
  basicMiddleware,
  AdminFiles("private").single("videoFile"),
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
router.put(
  "/admin/courses/:courseId/overview-video",
  basicMiddleware,
  AdminFiles("private").single("overviewVideo"),
  UpdateOverviewVideo
);

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
