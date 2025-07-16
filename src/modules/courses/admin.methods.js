const Course = require("./courses.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId, Types } = require("mongoose");
const VideoDurationExtractor = require("../../utils/media/videoDurationExtractor");
const path = require("path");
const fs = require("fs");

// ==================== CATEGORY MANAGEMENT ====================

// Create Category (embedded in course system)
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

    // Check if category already exists in any course
    const existingCategory = await Course.findOne({ "category.slug": slug });
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
    };

    return res
      .status(201)
      .json(
        GenRes(
          201,
          categoryData,
          null,
          "Category template created successfully"
        )
      );
  } catch (error) {
    console.error("Error creating category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get all categories (from existing courses)
const GetCategories = async (req, res) => {
  try {
    const categories = await Course.aggregate([
      {
        $group: {
          _id: "$category.slug",
          name: { $first: "$category.name" },
          description: { $first: "$category.description" },
          icon: { $first: "$category.icon" },
          color: { $first: "$category.color" },
          slug: { $first: "$category.slug" },
          courseCount: { $sum: 1 },
          totalEnrollments: { $sum: "$enrollmentCount" },
        },
      },
      { $sort: { name: 1 } },
    ]);

    return res
      .status(200)
      .json(GenRes(200, categories, null, "Categories retrieved successfully"));
  } catch (error) {
    console.error("Error getting categories:", error);
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

    // Validate required fields
    if (!data.title || !data.description) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Title and description are required" },
            "Please provide course title and description"
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

    // Process overview video duration if provided
    let overviewVideoDuration = "00:00:00";
    if (overviewVideoFile) {
      try {
        const videoPath = path.join(
          process.cwd(),
          overviewVideoFile.substring(1)
        );
        if (fs.existsSync(videoPath)) {
          const videoInfo = await VideoDurationExtractor.extractVideoInfo(
            videoPath
          );
          overviewVideoDuration = videoInfo.duration;
          console.log(
            `Overview video duration extracted: ${overviewVideoDuration}`
          );
        }
      } catch (error) {
        console.error("Error extracting overview video duration:", error);
      }
    }

    // Create category structure
    const categoryData = {
      id: new Types.ObjectId().toString(),
      name: data.categoryName || "General",
      description: data.categoryDescription || "",
      icon: data.categoryIcon || "📚",
      color: data.categoryColor || "#4A90E2",
      slug: (data.categoryName || "general")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    };

    const courseData = {
      ...data,
      thumbnail: thumbnailFile,
      overviewVideo: overviewVideoFile || data.overviewVideo,
      overviewVideoDuration,
      category: categoryData,
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

    const newCourse = new Course(courseData);
    await newCourse.save();

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

      // Extract new overview video duration
      try {
        const videoPath = path.join(
          process.cwd(),
          overviewVideoFile.substring(1)
        );
        if (fs.existsSync(videoPath)) {
          const videoInfo = await VideoDurationExtractor.extractVideoInfo(
            videoPath
          );
          data.overviewVideoDuration = videoInfo.duration;
          console.log(
            `Updated overview video duration: ${data.overviewVideoDuration}`
          );
        }
      } catch (error) {
        console.error(
          "Error extracting updated overview video duration:",
          error
        );
      }
    }

    // Update category if provided
    if (data.categoryName) {
      data.category = {
        name: data.categoryName,
        description: data.categoryDescription || course.category.description,
        icon: data.categoryIcon || course.category.icon,
        color: data.categoryColor || course.category.color,
        slug: data.categoryName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, ""),
      };
      delete data.categoryName;
      delete data.categoryDescription;
      delete data.categoryIcon;
      delete data.categoryColor;
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

    // Add course-level files
    course.courseVideos?.forEach((video) => {
      if (video.videoUrl) allFiles.push(video.videoUrl);
      if (video.thumbnail) allFiles.push(video.thumbnail);
    });

    course.coursePDFs?.forEach((pdf) => {
      if (pdf.fileUrl) allFiles.push(pdf.fileUrl);
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

    return res
      .status(200)
      .json(GenRes(200, null, null, "Course deleted successfully!"));
  } catch (error) {
    console.error("Error deleting course:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
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

// ==================== LESSON CONTENT MANAGEMENT ====================

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
      // Add multiple video files with duration extraction
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

      for (let index = 0; index < videoFiles.length; index++) {
        const file = videoFiles[index];
        let duration = "00:00:00";
        let metadata = {
          quality: "HD",
          fileSize: "Unknown",
          viewCount: 0,
          durationSeconds: 0,
        };

        // Extract video duration and metadata
        try {
          const videoPath = path.join(process.cwd(), file.substring(1));
          if (fs.existsSync(videoPath)) {
            const videoInfo = await VideoDurationExtractor.extractVideoInfo(
              videoPath
            );
            duration = videoInfo.duration;
            metadata = {
              ...metadata,
              durationSeconds: videoInfo.durationSeconds,
              quality: videoInfo.quality,
              fileSize: videoInfo.fileSize,
              width: videoInfo.width,
              height: videoInfo.height,
              aspectRatio: videoInfo.aspectRatio,
              bitrate: videoInfo.bitrate,
              codec: videoInfo.codec,
              format: videoInfo.format,
            };
            console.log(`Video duration extracted for ${file}: ${duration}`);
          }
        } catch (error) {
          console.error(`Error extracting video metadata for ${file}:`, error);
        }

        const newVideo = {
          title: title || `Video ${lesson.videos.length + index + 1}`,
          description: description || "",
          videoUrl: file,
          thumbnail: thumbnailFiles[index] || thumbnailFiles[0] || "",
          duration,
          sortOrder: sortOrder || lesson.videos.length + index,
          metadata,
        };

        lesson.videos.push(newVideo);
        addedVideos.push(newVideo);
      }

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

// Update lesson content (video or note)
const UpdateLessonContent = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update lesson content"
          )
        );
    }

    const { courseId, lessonId, contentId } = req.params;
    const { contentType, title, description } = req.body;
    const files = req.file_locations || [];

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
      if (!contentItem) {
        return res
          .status(404)
          .json(
            GenRes(404, null, { error: "Note not found" }, "Note not found")
          );
      }

      // Update note properties
      if (title) contentItem.title = title;
      if (description) contentItem.description = description;

      // Update file if provided
      const noteFile = files.find((file) =>
        /\.(pdf|doc|docx|txt)$/i.test(file)
      );
      if (noteFile) {
        // Delete old file
        if (contentItem.fileUrl) {
          try {
            const oldPath = path.join(
              process.cwd(),
              contentItem.fileUrl.slice(1)
            );
            fs.unlinkSync(oldPath);
          } catch (error) {
            console.log(`Failed to delete old note file: ${error?.message}`);
          }
        }
        contentItem.fileUrl = noteFile;
        contentItem.fileType = noteFile.endsWith(".pdf") ? "pdf" : "document";
      }
    } else if (contentType === "video") {
      contentItem = lesson.videos.id(contentId);
      if (!contentItem) {
        return res
          .status(404)
          .json(
            GenRes(404, null, { error: "Video not found" }, "Video not found")
          );
      }

      // Update video properties
      if (title) contentItem.title = title;
      if (description) contentItem.description = description;

      // Update video file if provided
      const videoFile = files.find((file) =>
        /\.(mp4|mov|avi|webm|mkv)$/i.test(file)
      );
      const thumbnailFile = files.find((file) =>
        /\.(jpg|jpeg|png|gif)$/i.test(file)
      );

      if (videoFile) {
        // Delete old video file
        if (contentItem.videoUrl) {
          try {
            const oldPath = path.join(
              process.cwd(),
              contentItem.videoUrl.slice(1)
            );
            fs.unlinkSync(oldPath);
          } catch (error) {
            console.log(`Failed to delete old video file: ${error?.message}`);
          }
        }

        contentItem.videoUrl = videoFile;

        // Extract new video duration and metadata
        try {
          const videoPath = path.join(process.cwd(), videoFile.substring(1));
          if (fs.existsSync(videoPath)) {
            const videoInfo = await VideoDurationExtractor.extractVideoInfo(
              videoPath
            );
            contentItem.duration = videoInfo.duration;
            contentItem.metadata = {
              ...contentItem.metadata,
              durationSeconds: videoInfo.durationSeconds,
              quality: videoInfo.quality,
              fileSize: videoInfo.fileSize,
              width: videoInfo.width,
              height: videoInfo.height,
              aspectRatio: videoInfo.aspectRatio,
              bitrate: videoInfo.bitrate,
              codec: videoInfo.codec,
              format: videoInfo.format,
            };
            console.log(`Updated video duration: ${contentItem.duration}`);
          }
        } catch (error) {
          console.error(`Error extracting updated video metadata:`, error);
        }
      }

      if (thumbnailFile) {
        // Delete old thumbnail
        if (contentItem.thumbnail) {
          try {
            const oldPath = path.join(
              process.cwd(),
              contentItem.thumbnail.slice(1)
            );
            fs.unlinkSync(oldPath);
          } catch (error) {
            console.log(`Failed to delete old thumbnail: ${error?.message}`);
          }
        }
        contentItem.thumbnail = thumbnailFile;
      }
    }

    await course.save();

    return res
      .status(200)
      .json(
        GenRes(200, contentItem, null, `${contentType} updated successfully`)
      );
  } catch (error) {
    console.error("Error updating lesson content:", error);
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

// ==================== COURSE CONTENT MANAGEMENT (Direct to Course) ====================

// Add video directly to course (not lesson-specific)
const AddCourseVideo = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add course videos"
          )
        );
    }

    const { courseId } = req.params;
    const { title, description, sortOrder } = req.body;
    const files = req.file_locations || [];

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

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

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Initialize course videos array if it doesn't exist
    if (!course.courseVideos) {
      course.courseVideos = [];
    }

    const addedVideos = [];

    for (let index = 0; index < videoFiles.length; index++) {
      const file = videoFiles[index];
      let duration = "00:00:00";
      let metadata = {
        quality: "HD",
        fileSize: "Unknown",
        viewCount: 0,
        durationSeconds: 0,
      };

      // Extract video duration and metadata
      try {
        const videoPath = path.join(process.cwd(), file.substring(1));
        if (fs.existsSync(videoPath)) {
          const videoInfo = await VideoDurationExtractor.extractVideoInfo(
            videoPath
          );
          duration = videoInfo.duration;
          metadata = {
            ...metadata,
            durationSeconds: videoInfo.durationSeconds,
            quality: videoInfo.quality,
            fileSize: videoInfo.fileSize,
            width: videoInfo.width,
            height: videoInfo.height,
            aspectRatio: videoInfo.aspectRatio,
            bitrate: videoInfo.bitrate,
            codec: videoInfo.codec,
            format: videoInfo.format,
          };
          console.log(
            `Course video duration extracted for ${file}: ${duration}`
          );
        }
      } catch (error) {
        console.error(
          `Error extracting course video metadata for ${file}:`,
          error
        );
      }

      const newVideo = {
        title:
          title || `Course Video ${course.courseVideos.length + index + 1}`,
        description: description || "",
        videoUrl: file,
        thumbnail: thumbnailFiles[index] || thumbnailFiles[0] || "",
        duration,
        sortOrder: sortOrder || course.courseVideos.length + index,
        metadata,
      };

      course.courseVideos.push(newVideo);
      addedVideos.push(newVideo);
    }

    await course.save();
    return res
      .status(201)
      .json(
        GenRes(
          201,
          addedVideos,
          null,
          `${addedVideos.length} course video(s) added successfully`
        )
      );
  } catch (error) {
    console.error("Error adding course video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Add PDF directly to course (not lesson-specific)
const AddCoursePDF = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add course PDFs"
          )
        );
    }

    const { courseId } = req.params;
    const { title, description, sortOrder } = req.body;
    const files = req.file_locations || [];

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const pdfFiles = files.filter((file) =>
      /\.(pdf|doc|docx|txt)$/i.test(file)
    );

    if (pdfFiles.length === 0) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "No PDF files found" },
            "Please upload PDF or document files"
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

    // Initialize course PDFs array if it doesn't exist
    if (!course.coursePDFs) {
      course.coursePDFs = [];
    }

    const addedPDFs = [];
    pdfFiles.forEach((file, index) => {
      const newPDF = {
        title: title || `Course PDF ${course.coursePDFs.length + index + 1}`,
        description: description || "",
        fileUrl: file,
        fileType: file.endsWith(".pdf") ? "pdf" : "document",
        sortOrder: sortOrder || course.coursePDFs.length + index,
        metadata: {
          fileSize: "Unknown",
          downloadCount: 0,
        },
      };
      course.coursePDFs.push(newPDF);
      addedPDFs.push(newPDF);
    });

    await course.save();
    return res
      .status(201)
      .json(
        GenRes(
          201,
          addedPDFs,
          null,
          `${addedPDFs.length} course PDF(s) added successfully`
        )
      );
  } catch (error) {
    console.error("Error adding course PDF:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  CreateCategory,
  GetCategories,
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
};
