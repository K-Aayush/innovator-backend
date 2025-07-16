const Course = require("./course.model");
const Category = require("./category.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const VideoDurationExtractor = require("../../utils/media/videoDurationExtractor");
const path = require("path");
const fs = require("fs");

// ==================== CATEGORY MANAGEMENT ====================

// Create Category
const CreateCategory = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can create categories"
          )
        );
    }

    const { name, description, icon, color } = req.body;

    if (!name) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Category name is required" },
            "Please provide a category name"
          )
        );
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const existingCategory = await Category.findOne({ slug });
    if (existingCategory) {
      return res
        .status(409)
        .json(
          GenRes(
            409,
            null,
            { error: "Category already exists" },
            "A category with this name already exists"
          )
        );
    }

    const categoryData = {
      name,
      description,
      icon,
      color: color || "#4A90E2",
      slug,
      createdBy: {
        _id: req.user._id,
        email: req.user.email,
        name: req.user.name || req.user.email,
      },
    };

    const newCategory = new Category(categoryData);
    await newCategory.save();

    return res
      .status(201)
      .json(GenRes(201, newCategory, null, "Category created successfully"));
  } catch (error) {
    console.error("Error creating category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update Category
const UpdateCategory = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update categories"
          )
        );
    }

    const { categoryId } = req.params;
    const updateData = req.body;

    if (!isValidObjectId(categoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid category ID" },
            "Invalid category ID"
          )
        );
    }

    delete updateData._id;
    delete updateData.createdBy;
    delete updateData.metadata;

    const updatedCategory = await Category.findByIdAndUpdate(
      categoryId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedCategory) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Category not found" },
            "Category not found"
          )
        );
    }

    return res
      .status(200)
      .json(
        GenRes(200, updatedCategory, null, "Category updated successfully")
      );
  } catch (error) {
    console.error("Error updating category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete Category
const DeleteCategory = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete categories"
          )
        );
    }

    const { categoryId } = req.params;

    if (!isValidObjectId(categoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid category ID" },
            "Invalid category ID"
          )
        );
    }

    const category = await Category.findById(categoryId);
    if (!category) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Category not found" },
            "Category not found"
          )
        );
    }

    // Check if category has courses
    const courseCount = await Course.countDocuments({
      "category._id": categoryId,
    });

    if (courseCount > 0) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Category has courses" },
            "Cannot delete category that contains courses"
          )
        );
    }

    await Category.findByIdAndDelete(categoryId);

    return res
      .status(200)
      .json(GenRes(200, null, null, "Category deleted successfully"));
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// ==================== COURSE MANAGEMENT ====================

// Create Course
const CreateCourse = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can create courses"
          )
        );
    }

    const data = req.body;
    const files = req.file_locations || [];
    const thumbnailFile = files.find((f) => f.includes("thumbnail"));
    const overviewVideoFile = files.find((f) => f.includes("overviewVideo"));

    // Validate required category
    if (!data.categoryId || !isValidObjectId(data.categoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Valid category ID is required" },
            "Please select a valid category"
          )
        );
    }

    if (!thumbnailFile) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Course thumbnail is required" },
            "Please upload a course thumbnail"
          )
        );
    }

    // Validate category exists
    const category = await Category.findById(data.categoryId);
    if (!category) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Category not found" },
            "Selected category not found"
          )
        );
    }

    const courseData = {
      ...data,
      thumbnail: thumbnailFile,
      overviewVideo: overviewVideoFile || data.overviewVideo,
      category: {
        _id: category._id.toString(),
        name: category.name,
        slug: category.slug,
      },
      author: {
        email: req.user.email,
        phone: req.user.phone || "Not provided",
        _id: req.user._id,
      },
      lessons: data.lessons || [],
      instructor: data.instructor || {
        name: req.user.name || "Admin",
        bio: "Course Instructor",
        picture: "",
        credentials: [],
      },
    };

    // Remove processed ID from courseData
    delete courseData.categoryId;

    const newCourse = new Course(courseData);
    await newCourse.save();

    // Update category metadata
    await updateCategoryMetadata(category._id);

    return res
      .status(200)
      .json(
        GenRes(200, newCourse.toObject(), null, "Course created successfully!")
      );
  } catch (error) {
    console.error("Error creating course:", error);
    return res.status(500).json(GenRes(500, null, { error }, error?.message));
  }
};

// Update Course
const UpdateCourse = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update courses"
          )
        );
    }

    const { courseId } = req.params;
    const data = req.body;
    const files = req.file_locations || [];
    const thumbnailFile = files.find((f) => f.includes("thumbnail"));
    const overviewVideoFile = files.find((f) => f.includes("overviewVideo"));

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Remove fields that shouldn't be updated directly
    delete data._id;
    delete data.author;
    delete data.createdAt;
    delete data.updatedAt;

    // Update files if uploaded
    if (thumbnailFile) {
      if (course.thumbnail) {
        try {
          const oldPath = path.join(process.cwd(), course.thumbnail.slice(1));
          fs.unlinkSync(oldPath);
        } catch (error) {
          console.log(`Failed to delete old thumbnail: ${error?.message}`);
        }
      }
      data.thumbnail = thumbnailFile;
    }

    if (overviewVideoFile) {
      if (course.overviewVideo) {
        try {
          const oldPath = path.join(
            process.cwd(),
            course.overviewVideo.slice(1)
          );
          fs.unlinkSync(oldPath);
        } catch (error) {
          console.log(`Failed to delete old overview video: ${error?.message}`);
        }
      }
      data.overviewVideo = overviewVideoFile;
    }

    const updatedCourse = await Course.findByIdAndUpdate(
      courseId,
      { $set: data },
      { new: true, runValidators: true }
    );

    return res
      .status(200)
      .json(GenRes(200, updatedCourse, null, "Course updated successfully"));
  } catch (error) {
    console.error("Error updating course:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete Course
const DeleteCourse = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete courses"
          )
        );
    }

    const { courseId } = req.params;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const categoryId = course.category._id;

    // Delete associated files
    const allFiles = [course.thumbnail, course.overviewVideo].filter(Boolean);

    // Add lesson files
    course.lessons?.forEach((lesson) => {
      lesson.notes?.forEach((note) => {
        if (note.fileUrl) allFiles.push(note.fileUrl);
      });
      lesson.videos?.forEach((video) => {
        if (video.videoUrl) allFiles.push(video.videoUrl);
        if (video.thumbnail) allFiles.push(video.thumbnail);
      });
    });

    if (allFiles.length > 0) {
      const failedFiles = [];
      for (const file of allFiles) {
        try {
          const filePath = path.join(process.cwd(), file.slice(1));
          fs.unlinkSync(filePath);
        } catch (error) {
          console.log(`Failed to delete file ${file}:`, error?.message);
          failedFiles.push(file);
        }
      }
      if (failedFiles.length > 0) {
        console.log("Some files failed to delete:", failedFiles);
      }
    }

    await Course.findByIdAndDelete(courseId);

    // Update category metadata
    await updateCategoryMetadata(categoryId);

    return res
      .status(200)
      .json(GenRes(200, null, null, "Course deleted successfully!"));
  } catch (error) {
    console.error("Error deleting course:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Helper function to update category metadata
async function updateCategoryMetadata(categoryId) {
  try {
    const courses = await Course.find({
      "category._id": categoryId,
    });

    let totalCourses = courses.length;
    let totalLessons = 0;
    let totalNotes = 0;
    let totalVideos = 0;

    courses.forEach((course) => {
      totalLessons += course.lessons?.length || 0;
      course.lessons?.forEach((lesson) => {
        totalNotes += lesson.notes?.length || 0;
        totalVideos += lesson.videos?.length || 0;
      });
    });

    await Category.findByIdAndUpdate(categoryId, {
      $set: {
        "metadata.totalCourses": totalCourses,
        "metadata.totalLessons": totalLessons,
        "metadata.totalNotes": totalNotes,
        "metadata.totalVideos": totalVideos,
        "metadata.lastUpdated": new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating category metadata:", error);
  }
}

module.exports = {
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
  DeleteLessonContent,
};
// ==================== LESSON MANAGEMENT ====================

// Add lesson to course
const AddLesson = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add lessons"
          )
        );
    }

    const { courseId } = req.params;
    const { title, description, duration, sortOrder } = req.body;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const newLesson = {
      title: title || "New Lesson",
      description: description || "",
      duration: duration || "",
      sortOrder: sortOrder || course.lessons.length,
      isPublished: true,
      notes: [],
      videos: [],
      metadata: {
        estimatedTime: 0,
        difficulty: "beginner",
      },
    };

    course.lessons.push(newLesson);
    await course.save();

    const addedLesson = course.lessons[course.lessons.length - 1];

    return res
      .status(201)
      .json(GenRes(201, addedLesson, null, "Lesson added successfully"));
  } catch (error) {
    console.error("Error adding lesson:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update lesson
const UpdateLesson = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update lessons"
          )
        );
    }

    const { courseId, lessonId } = req.params;
    const updateData = req.body;

    if (!isValidObjectId(courseId) || !isValidObjectId(lessonId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or lesson ID"
          )
        );
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const lesson = course.lessons.id(lessonId);
    if (!lesson) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
        );
    }

    // Update lesson fields
    Object.keys(updateData).forEach((key) => {
      if (key !== "_id" && key !== "notes" && key !== "videos") {
        lesson[key] = updateData[key];
      }
    });

    await course.save();

    return res
      .status(200)
      .json(GenRes(200, lesson, null, "Lesson updated successfully"));
  } catch (error) {
    console.error("Error updating lesson:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete lesson
const DeleteLesson = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete lessons"
          )
        );
    }

    const { courseId, lessonId } = req.params;

    if (!isValidObjectId(courseId) || !isValidObjectId(lessonId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or lesson ID"
          )
        );
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const lesson = course.lessons.id(lessonId);
    if (!lesson) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
        );
    }

    // Delete associated files
    const allFiles = [];
    lesson.notes?.forEach((note) => {
      if (note.fileUrl) allFiles.push(note.fileUrl);
    });
    lesson.videos?.forEach((video) => {
      if (video.videoUrl) allFiles.push(video.videoUrl);
      if (video.thumbnail) allFiles.push(video.thumbnail);
    });

    // Delete files from filesystem
    if (allFiles.length > 0) {
      for (const file of allFiles) {
        try {
          const filePath = path.join(process.cwd(), file.slice(1));
          fs.unlinkSync(filePath);
        } catch (error) {
          console.log(`Failed to delete file ${file}:`, error?.message);
        }
      }
    }

    // Remove lesson from course
    lesson.remove();
    await course.save();

    return res
      .status(200)
      .json(GenRes(200, null, null, "Lesson deleted successfully"));
  } catch (error) {
    console.error("Error deleting lesson:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Add content (notes/videos) to lesson
const AddLessonContent = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add lesson content"
          )
        );
    }

    const { courseId, lessonId } = req.params;
    const { contentType, title, description, sortOrder } = req.body;
    const files = req.file_locations || [];

    if (!isValidObjectId(courseId) || !isValidObjectId(lessonId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or lesson ID"
          )
        );
    }

    if (!contentType || !["note", "video"].includes(contentType)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid content type" },
            "Content type must be 'note' or 'video'"
          )
        );
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const lesson = course.lessons.id(lessonId);
    if (!lesson) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
        );
    }

    if (contentType === "note") {
      // Add multiple PDF/document files
      const noteFiles = files.filter((file) =>
        /\.(pdf|doc|docx|txt)$/i.test(file)
      );

      if (noteFiles.length === 0) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "No note files found" },
              "Please upload PDF or document files"
            )
          );
      }

      const addedNotes = [];
      noteFiles.forEach((file, index) => {
        const newNote = {
          title: title || `Note ${lesson.notes.length + index + 1}`,
          description: description || "",
          fileUrl: file,
          fileType: file.endsWith(".pdf") ? "pdf" : "document",
          sortOrder: sortOrder || lesson.notes.length + index,
          metadata: {
            fileSize: "Unknown",
            downloadCount: 0,
          },
        };
        lesson.notes.push(newNote);
        addedNotes.push(newNote);
      });

      await course.save();
      return res
        .status(201)
        .json(
          GenRes(
            201,
            addedNotes,
            null,
            `${addedNotes.length} note(s) added successfully`
          )
        );
    } else if (contentType === "video") {
      // Add multiple video files
      const videoFiles = files.filter((file) =>
        /\.(mp4|mov|avi|webm|mkv)$/i.test(file)
      );
      const thumbnailFiles = files.filter((file) =>
        /\.(jpg|jpeg|png|gif)$/i.test(file)
      );

      if (videoFiles.length === 0) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "No video files found" },
              "Please upload video files"
            )
          );
      }

      const addedVideos = [];
      videoFiles.forEach((file, index) => {
        const newVideo = {
          title: title || `Video ${lesson.videos.length + index + 1}`,
          description: description || "",
          videoUrl: file,
          thumbnail: thumbnailFiles[index] || thumbnailFiles[0] || "",
          duration: "00:00:00",
          sortOrder: sortOrder || lesson.videos.length + index,
          metadata: {
            quality: "HD",
            fileSize: "Unknown",
            viewCount: 0,
            durationSeconds: 0,
          },
        };
        lesson.videos.push(newVideo);
        addedVideos.push(newVideo);
      });

      await course.save();
      return res
        .status(201)
        .json(
          GenRes(
            201,
            addedVideos,
            null,
            `${addedVideos.length} video(s) added successfully`
          )
        );
    }
  } catch (error) {
    console.error("Error adding lesson content:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete content from lesson
const DeleteLessonContent = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete lesson content"
          )
        );
    }

    const { courseId, lessonId, contentId } = req.params;
    const { contentType } = req.query;

    if (
      !isValidObjectId(courseId) ||
      !isValidObjectId(lessonId) ||
      !isValidObjectId(contentId)
    ) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid IDs" }, "Invalid IDs provided")
        );
    }

    if (!contentType || !["note", "video"].includes(contentType)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid content type" },
            "Content type must be 'note' or 'video'"
          )
        );
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const lesson = course.lessons.id(lessonId);
    if (!lesson) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
        );
    }

    let contentItem;
    if (contentType === "note") {
      contentItem = lesson.notes.id(contentId);
      if (contentItem) {
        // Delete file from filesystem
        try {
          const filePath = path.join(
            process.cwd(),
            contentItem.fileUrl.slice(1)
          );
          fs.unlinkSync(filePath);
        } catch (error) {
          console.log(`Failed to delete note file:`, error?.message);
        }
        contentItem.remove();
      }
    } else if (contentType === "video") {
      contentItem = lesson.videos.id(contentId);
      if (contentItem) {
        // Delete video and thumbnail files
        const filesToDelete = [
          contentItem.videoUrl,
          contentItem.thumbnail,
        ].filter(Boolean);
        for (const file of filesToDelete) {
          try {
            const filePath = path.join(process.cwd(), file.slice(1));
            fs.unlinkSync(filePath);
          } catch (error) {
            console.log(`Failed to delete video file:`, error?.message);
          }
        }
        contentItem.remove();
      }
    }

    if (!contentItem) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Content not found" },
            "Content item not found"
          )
        );
    }

    await course.save();

    return res
      .status(200)
      .json(GenRes(200, null, null, `${contentType} deleted successfully`));
  } catch (error) {
    console.error("Error deleting lesson content:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};
