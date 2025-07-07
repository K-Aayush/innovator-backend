const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const CourseCategory = require("./course.hierarchy.model");
const EnhancedCourse = require("./course.enhanced.model");
const VideoDurationExtractor = require("../../utils/media/videoDurationExtractor");
const path = require("path");
const fs = require("fs");

// ==================== CATEGORY MANAGEMENT ====================

// Create Parent Category
const CreateParentCategory = async (req, res) => {
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

    const { name, description, icon, color, image, bannerImage } = req.body;

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
    const existingCategory = await CourseCategory.findOne({ slug });

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
      image,
      bannerImage,
      level: "parent",
      slug,
      createdBy: {
        _id: req.user._id,
        email: req.user.email,
        name: req.user.name || req.user.email,
      },
    };

    const newCategory = new CourseCategory(categoryData);
    await newCategory.save();

    return res
      .status(201)
      .json(
        GenRes(201, newCategory, null, "Parent category created successfully")
      );
  } catch (error) {
    console.error("Error creating parent category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Create Subcategory
const CreateSubcategory = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can create subcategories"
          )
        );
    }

    const {
      name,
      description,
      icon,
      color,
      image,
      bannerImage,
      parentCategoryId,
    } = req.body;

    if (!name || !parentCategoryId) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Name and parent category are required" },
            "Please provide all required fields"
          )
        );
    }

    if (!isValidObjectId(parentCategoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid parent category ID" },
            "Invalid parent category ID"
          )
        );
    }

    const parentCategory = await CourseCategory.findById(parentCategoryId);
    if (!parentCategory || parentCategory.level !== "parent") {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Parent category not found" },
            "Parent category not found"
          )
        );
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const existingCategory = await CourseCategory.findOne({ slug });

    if (existingCategory) {
      return res
        .status(409)
        .json(
          GenRes(
            409,
            null,
            { error: "Subcategory already exists" },
            "A subcategory with this name already exists"
          )
        );
    }

    const subcategoryData = {
      name,
      description,
      icon,
      color: color || "#4A90E2",
      image,
      bannerImage,
      parentCategory: parentCategoryId,
      level: "subcategory",
      slug,
      createdBy: {
        _id: req.user._id,
        email: req.user.email,
        name: req.user.name || req.user.email,
      },
    };

    const newSubcategory = new CourseCategory(subcategoryData);
    await newSubcategory.save();

    // Update parent category's subcategories array
    await CourseCategory.findByIdAndUpdate(parentCategoryId, {
      $addToSet: { subcategories: newSubcategory._id },
    });

    return res
      .status(201)
      .json(
        GenRes(201, newSubcategory, null, "Subcategory created successfully")
      );
  } catch (error) {
    console.error("Error creating subcategory:", error);
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
    delete updateData.subcategories;

    const updatedCategory = await CourseCategory.findByIdAndUpdate(
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

    const category = await CourseCategory.findById(categoryId);
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
    const courseCount = await EnhancedCourse.countDocuments({
      $or: [
        { "parentCategory._id": categoryId },
        { "subcategory._id": categoryId },
      ],
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

    // Check if category has subcategories
    if (category.level === "parent") {
      const subcategoryCount = await CourseCategory.countDocuments({
        parentCategory: categoryId,
      });

      if (subcategoryCount > 0) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "Category has subcategories" },
              "Cannot delete category that has subcategories"
            )
          );
      }
    }

    const deletedCategory = await CourseCategory.findByIdAndDelete(categoryId);

    // Remove from parent's subcategories array if it was a subcategory
    if (deletedCategory.parentCategory) {
      await CourseCategory.findByIdAndUpdate(deletedCategory.parentCategory, {
        $pull: { subcategories: categoryId },
      });
    }

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

    // Validate required categories
    if (!data.parentCategoryId || !isValidObjectId(data.parentCategoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Valid parent category ID is required" },
            "Please select a valid parent category"
          )
        );
    }

    if (!data.subcategoryId || !isValidObjectId(data.subcategoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Valid subcategory ID is required" },
            "Please select a valid subcategory"
          )
        );
    }

    // Validate categories exist and hierarchy is correct
    const [parentCategory, subcategory] = await Promise.all([
      CourseCategory.findById(data.parentCategoryId),
      CourseCategory.findById(data.subcategoryId),
    ]);

    if (!parentCategory || parentCategory.level !== "parent") {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Parent category not found" },
            "Selected parent category not found"
          )
        );
    }

    if (!subcategory || subcategory.level !== "subcategory") {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Subcategory not found" },
            "Selected subcategory not found"
          )
        );
    }

    if (
      subcategory.parentCategory.toString() !== parentCategory._id.toString()
    ) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid category hierarchy" },
            "Subcategory does not belong to the selected parent category"
          )
        );
    }

    const courseData = {
      ...data,
      parentCategory: {
        _id: parentCategory._id.toString(),
        name: parentCategory.name,
        slug: parentCategory.slug,
      },
      subcategory: {
        _id: subcategory._id.toString(),
        name: subcategory.name,
        slug: subcategory.slug,
      },
      author: {
        email: req.user.email,
        phone: req.user.phone || "Not provided",
        _id: req.user._id,
      },
      lessons: data.lessons || [],
      notes: data.notes || [],
      videos: data.videos || [],
      instructor: data.instructor || {
        name: req.user.name || "Admin",
        bio: "Course Instructor",
        picture: "",
        credentials: [],
      },
    };

    // Remove processed IDs from courseData
    delete courseData.parentCategoryId;
    delete courseData.subcategoryId;

    const newCourse = new EnhancedCourse(courseData);
    await newCourse.save();

    // Update category metadata
    await Promise.all([
      updateCategoryMetadata(parentCategory._id),
      updateCategoryMetadata(subcategory._id),
    ]);

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

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    delete data._id;
    delete data.author;
    delete data.createdAt;
    delete data.updatedAt;

    const updatedCourse = await EnhancedCourse.findByIdAndUpdate(
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

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const parentCategoryId = course.parentCategory._id;
    const subcategoryId = course.subcategory._id;

    // Delete associated files
    const allFiles = [
      ...(course.notes?.map((note) => note.fileUrl).filter(Boolean) || []),
      ...(course.videos?.map((video) => video.videoUrl).filter(Boolean) || []),
      course.thumbnail,
      course.bannerImage,
      course.overviewVideo,
    ].filter(Boolean);

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

    await EnhancedCourse.findByIdAndDelete(courseId);

    // Update category metadata
    await Promise.all([
      updateCategoryMetadata(parentCategoryId),
      updateCategoryMetadata(subcategoryId),
    ]);

    return res
      .status(200)
      .json(GenRes(200, null, null, "Course deleted successfully!"));
  } catch (error) {
    console.error("Error deleting course:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// ==================== LESSON MANAGEMENT ====================

// Add Lesson to Course
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
    const lessonData = req.body;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const newLesson = {
      ...lessonData,
      sortOrder: lessonData.sortOrder || course.lessons.length,
    };

    course.lessons.push(newLesson);
    await course.save();

    return res
      .status(200)
      .json(GenRes(200, newLesson, null, "Lesson added successfully"));
  } catch (error) {
    console.error("Error adding lesson:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update Lesson
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

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const lessonIndex = course.lessons.findIndex(
      (lesson) => lesson._id.toString() === lessonId
    );
    if (lessonIndex === -1) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
        );
    }

    // Update lesson
    Object.assign(course.lessons[lessonIndex], updateData);
    await course.save();

    return res
      .status(200)
      .json(
        GenRes(
          200,
          course.lessons[lessonIndex],
          null,
          "Lesson updated successfully"
        )
      );
  } catch (error) {
    console.error("Error updating lesson:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete Lesson
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

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Remove lesson
    course.lessons = course.lessons.filter(
      (lesson) => lesson._id.toString() !== lessonId
    );

    // Remove all notes and videos associated with this lesson
    course.notes = course.notes.filter(
      (note) => note.lessonId?.toString() !== lessonId
    );
    course.videos = course.videos.filter(
      (video) => video.lessonId?.toString() !== lessonId
    );

    await course.save();

    return res
      .status(200)
      .json(
        GenRes(
          200,
          null,
          null,
          "Lesson and associated content deleted successfully"
        )
      );
  } catch (error) {
    console.error("Error deleting lesson:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// ==================== NOTE MANAGEMENT ====================

// Add Note to Course
const AddNote = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add notes"
          )
        );
    }

    const { courseId } = req.params;
    const noteData = req.body;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Validate lesson ID if provided
    if (noteData.lessonId && !isValidObjectId(noteData.lessonId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid lesson ID" }, "Invalid lesson ID")
        );
    }

    if (noteData.lessonId) {
      const lessonExists = course.lessons.some(
        (lesson) => lesson._id.toString() === noteData.lessonId
      );
      if (!lessonExists) {
        return res
          .status(404)
          .json(
            GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
          );
      }
    }

    const newNote = {
      ...noteData,
      sortOrder: noteData.sortOrder || course.notes.length,
      lessonId: noteData.lessonId || null,
    };

    course.notes.push(newNote);
    await course.save();

    return res
      .status(200)
      .json(GenRes(200, newNote, null, "Note added successfully"));
  } catch (error) {
    console.error("Error adding note:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update Note
const UpdateNote = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update notes"
          )
        );
    }

    const { courseId, noteId } = req.params;
    const updateData = req.body;

    if (!isValidObjectId(courseId) || !isValidObjectId(noteId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or note ID"
          )
        );
    }

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const noteIndex = course.notes.findIndex(
      (note) => note._id.toString() === noteId
    );
    if (noteIndex === -1) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "Note not found" }, "Note not found"));
    }

    // Update note
    Object.assign(course.notes[noteIndex], updateData);
    await course.save();

    return res
      .status(200)
      .json(
        GenRes(200, course.notes[noteIndex], null, "Note updated successfully")
      );
  } catch (error) {
    console.error("Error updating note:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete Note
const DeleteNote = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete notes"
          )
        );
    }

    const { courseId, noteId } = req.params;

    if (!isValidObjectId(courseId) || !isValidObjectId(noteId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or note ID"
          )
        );
    }

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const noteIndex = course.notes.findIndex(
      (note) => note._id.toString() === noteId
    );
    if (noteIndex === -1) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "Note not found" }, "Note not found"));
    }

    // Delete file if exists
    const note = course.notes[noteIndex];
    if (note.fileUrl) {
      try {
        const filePath = path.join(process.cwd(), note.fileUrl.slice(1));
        fs.unlinkSync(filePath);
      } catch (error) {
        console.log(
          `Failed to delete note file ${note.fileUrl}:`,
          error?.message
        );
      }
    }

    // Remove note
    course.notes.splice(noteIndex, 1);
    await course.save();

    return res
      .status(200)
      .json(GenRes(200, null, null, "Note deleted successfully"));
  } catch (error) {
    console.error("Error deleting note:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// ==================== VIDEO MANAGEMENT ====================

// Add Video to Course
const AddVideo = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add videos"
          )
        );
    }

    const { courseId } = req.params;
    const videoData = req.body;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Validate lesson ID if provided
    if (videoData.lessonId && !isValidObjectId(videoData.lessonId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid lesson ID" }, "Invalid lesson ID")
        );
    }

    if (videoData.lessonId) {
      const lessonExists = course.lessons.some(
        (lesson) => lesson._id.toString() === videoData.lessonId
      );
      if (!lessonExists) {
        return res
          .status(404)
          .json(
            GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
          );
      }
    }

    // Extract video metadata if video URL is provided
    let duration = videoData.duration || "00:00:00";
    let metadata = {};

    if (videoData.videoUrl) {
      try {
        const videoPath = path.join(
          process.cwd(),
          videoData.videoUrl.substring(1)
        );
        if (fs.existsSync(videoPath)) {
          const videoMetadata = await VideoDurationExtractor.getVideoMetadata(
            videoPath
          );
          duration = videoMetadata.duration.formatted;
          metadata = {
            durationSeconds: videoMetadata.duration.seconds,
            quality: videoMetadata.quality,
            aspectRatio: videoMetadata.video?.aspectRatio,
            fileSize: videoMetadata.format.size,
            bitrate: videoMetadata.format.bitrate,
          };
        }
      } catch (error) {
        console.error(`Error extracting video metadata:`, error);
      }
    }

    const newVideo = {
      ...videoData,
      duration,
      metadata,
      sortOrder: videoData.sortOrder || course.videos.length,
      lessonId: videoData.lessonId || null,
    };

    course.videos.push(newVideo);
    await course.save();

    return res
      .status(200)
      .json(GenRes(200, newVideo, null, "Video added successfully"));
  } catch (error) {
    console.error("Error adding video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update Video
const UpdateVideo = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update videos"
          )
        );
    }

    const { courseId, videoId } = req.params;
    const updateData = req.body;

    if (!isValidObjectId(courseId) || !isValidObjectId(videoId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or video ID"
          )
        );
    }

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const videoIndex = course.videos.findIndex(
      (video) => video._id.toString() === videoId
    );
    if (videoIndex === -1) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Video not found" }, "Video not found")
        );
    }

    // Update video
    Object.assign(course.videos[videoIndex], updateData);
    await course.save();

    return res
      .status(200)
      .json(
        GenRes(
          200,
          course.videos[videoIndex],
          null,
          "Video updated successfully"
        )
      );
  } catch (error) {
    console.error("Error updating video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete Video
const DeleteVideo = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete videos"
          )
        );
    }

    const { courseId, videoId } = req.params;

    if (!isValidObjectId(courseId) || !isValidObjectId(videoId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or video ID"
          )
        );
    }

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const videoIndex = course.videos.findIndex(
      (video) => video._id.toString() === videoId
    );
    if (videoIndex === -1) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Video not found" }, "Video not found")
        );
    }

    // Delete video file if exists
    const video = course.videos[videoIndex];
    if (video.videoUrl) {
      try {
        const filePath = path.join(process.cwd(), video.videoUrl.slice(1));
        fs.unlinkSync(filePath);
      } catch (error) {
        console.log(
          `Failed to delete video file ${video.videoUrl}:`,
          error?.message
        );
      }
    }

    // Delete thumbnail if exists
    if (video.thumbnail) {
      try {
        const filePath = path.join(process.cwd(), video.thumbnail.slice(1));
        fs.unlinkSync(filePath);
      } catch (error) {
        console.log(
          `Failed to delete thumbnail ${video.thumbnail}:`,
          error?.message
        );
      }
    }

    // Remove video
    course.videos.splice(videoIndex, 1);
    await course.save();

    return res
      .status(200)
      .json(GenRes(200, null, null, "Video deleted successfully"));
  } catch (error) {
    console.error("Error deleting video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// ==================== OVERVIEW VIDEO MANAGEMENT ====================

// Update Overview Video
const UpdateOverviewVideo = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update overview video"
          )
        );
    }

    const { courseId } = req.params;
    const { overviewVideo } = req.body;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await EnhancedCourse.findByIdAndUpdate(
      courseId,
      { $set: { overviewVideo } },
      { new: true, runValidators: true }
    );

    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { overviewVideo: course.overviewVideo },
          null,
          "Overview video updated successfully"
        )
      );
  } catch (error) {
    console.error("Error updating overview video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete Overview Video
const DeleteOverviewVideo = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete overview video"
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

    const course = await EnhancedCourse.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Delete overview video file if exists
    if (course.overviewVideo) {
      try {
        const filePath = path.join(
          process.cwd(),
          course.overviewVideo.slice(1)
        );
        fs.unlinkSync(filePath);
      } catch (error) {
        console.log(
          `Failed to delete overview video file ${course.overviewVideo}:`,
          error?.message
        );
      }
    }

    course.overviewVideo = null;
    await course.save();

    return res
      .status(200)
      .json(GenRes(200, null, null, "Overview video deleted successfully"));
  } catch (error) {
    console.error("Error deleting overview video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

async function updateCategoryMetadata(categoryId) {
  try {
    const category = await CourseCategory.findById(categoryId);
    if (!category) return;

    let totalCourses = 0;
    let totalNotes = 0;
    let totalVideos = 0;
    let totalLessons = 0;
    let totalDuration = 0;

    if (category.level === "parent") {
      const subcategories = await CourseCategory.find({
        parentCategory: categoryId,
        level: "subcategory",
      });

      for (const subcategory of subcategories) {
        const courses = await EnhancedCourse.find({
          "subcategory._id": subcategory._id.toString(),
        });

        totalCourses += courses.length;

        courses.forEach((course) => {
          totalNotes += course.notes?.length || 0;
          totalVideos += course.videos?.length || 0;
          totalLessons += course.lessons?.length || 0;

          course.videos?.forEach((video) => {
            if (video.metadata?.durationSeconds) {
              totalDuration += video.metadata.durationSeconds;
            }
          });
        });
      }
    } else if (category.level === "subcategory") {
      const courses = await EnhancedCourse.find({
        "subcategory._id": categoryId,
      });

      totalCourses = courses.length;

      courses.forEach((course) => {
        totalNotes += course.notes?.length || 0;
        totalVideos += course.videos?.length || 0;
        totalLessons += course.lessons?.length || 0;

        course.videos?.forEach((video) => {
          if (video.metadata?.durationSeconds) {
            totalDuration += video.metadata.durationSeconds;
          }
        });
      });
    }

    await CourseCategory.findByIdAndUpdate(categoryId, {
      $set: {
        "metadata.totalCourses": totalCourses,
        "metadata.totalNotes": totalNotes,
        "metadata.totalVideos": totalVideos,
        "metadata.totalLessons": totalLessons,
        "metadata.totalDuration": totalDuration,
        "metadata.lastUpdated": new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating category metadata:", error);
  }
}

module.exports = {
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
};
