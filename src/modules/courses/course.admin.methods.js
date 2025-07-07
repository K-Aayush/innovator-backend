const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const Courses = require("./courses.model");
const CourseCategory = require("./course.category.model");
const VideoDurationExtractor = require("../../utils/media/videoDurationExtractor");
const path = require("path");
const fs = require("fs");

const AddCourse = async (req, res) => {
  try {
    const data = req?.body;
    const author = req?.admin;

    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add courses"
          )
        );
    }

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

    // Process lessons
    const processedLessons = (data.lessons || []).map((lesson, index) => ({
      ...lesson,
      sortOrder: lesson.sortOrder || index,
    }));

    // Process notes with lesson association
    const processedNotes = await Promise.all(
      (data.notes || []).map(async (note, index) => {
        let fileType = "text";
        let metadata = {};

        if (note.fileUrl) {
          const ext = path.extname(note.fileUrl).toLowerCase();
          if (ext === ".pdf") {
            fileType = "pdf";
          } else {
            fileType = "document";
          }

          // Add file metadata if available
          try {
            const filePath = path.join(
              process.cwd(),
              note.fileUrl.substring(1)
            );
            if (fs.existsSync(filePath)) {
              const stats = fs.statSync(filePath);
              metadata.fileSize = `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
            }
          } catch (error) {
            console.error(
              `Error getting file stats for ${note.fileUrl}:`,
              error
            );
          }
        }

        return {
          ...note,
          fileType,
          metadata,
          sortOrder: note.sortOrder || index,
          lessonId:
            note.lessonId && isValidObjectId(note.lessonId)
              ? note.lessonId
              : null,
        };
      })
    );

    // Process videos with lesson association and duration extraction
    const processedVideos = await Promise.all(
      (data.videos || []).map(async (video, index) => {
        let duration = video.duration || "00:00:00";
        let metadata = {};

        if (video.videoUrl) {
          try {
            const videoPath = path.join(
              process.cwd(),
              video.videoUrl.substring(1)
            );
            if (fs.existsSync(videoPath)) {
              const videoMetadata =
                await VideoDurationExtractor.getVideoMetadata(videoPath);
              duration = videoMetadata.duration.formatted;
              metadata = {
                durationSeconds: videoMetadata.duration.seconds,
                quality: videoMetadata.quality,
                aspectRatio: videoMetadata.video?.aspectRatio,
                fileSize: videoMetadata.format.size,
                bitrate: videoMetadata.format.bitrate,
              };
              console.log(
                `Extracted video metadata for ${video.title}:`,
                metadata
              );
            }
          } catch (error) {
            console.error(
              `Error extracting video metadata for ${video.title}:`,
              error
            );
            duration = "00:00:00";
          }
        }

        return {
          ...video,
          duration,
          metadata,
          sortOrder: video.sortOrder || index,
          lessonId:
            video.lessonId && isValidObjectId(video.lessonId)
              ? video.lessonId
              : null,
        };
      })
    );

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
        email: author?.email,
        phone: author?.phone || "Not provided",
        _id: author?._id,
      },
      lessons: processedLessons,
      notes: processedNotes,
      videos: processedVideos,
      instructor: data.instructor || {
        name: author?.name || "Admin",
        bio: "Course Instructor",
        picture: "",
        credentials: [],
      },
    };

    // Remove processed IDs from courseData
    delete courseData.parentCategoryId;
    delete courseData.subcategoryId;

    const newCourse = new Courses(courseData);
    await newCourse.save();

    // Update category metadata
    await Promise.all([
      updateCategoryMetadata(parentCategory._id),
      updateCategoryMetadata(subcategory._id),
    ]);

    const response = GenRes(
      200,
      newCourse.toObject(),
      null,
      "Course added successfully!"
    );
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error adding course:", error);
    const response = GenRes(500, null, { error }, error?.message);
    return res.status(500).json(response);
  }
};

const DelCourses = async (req, res) => {
  try {
    const _id = req?.params?.id;

    // Check if user is admin
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

    if (!_id || !isValidObjectId(_id)) {
      const response = GenRes(
        400,
        null,
        { error: "Invalid ID , Must be object ID" },
        "Invalid or Incorrect _id"
      );
      return res.status(400).json(response);
    }

    const course = await Courses.findById(_id);
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

    await Courses.findOneAndDelete({ _id });

    // Update category metadata
    await Promise.all([
      updateCategoryMetadata(parentCategoryId),
      updateCategoryMetadata(subcategoryId),
    ]);

    const response = GenRes(200, null, null, "Course deleted successfully!");
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error deleting course:", error);
    const response = GenRes(500, null, { error }, error?.message);
    return res.status(500).json(response);
  }
};

// Add lesson to existing course
const AddLessonToCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const lessonData = req.body;

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

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Courses.findById(courseId);
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

// Add note to course with optional lesson association
const AddNoteToCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const noteData = req.body;

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

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Courses.findById(courseId);
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

// Add video to course with optional lesson association
const AddVideoToCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const videoData = req.body;

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

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Courses.findById(courseId);
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

// Helper function to update category metadata
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
      // For parent categories, aggregate from all subcategories
      const subcategories = await CourseCategory.find({
        parentCategory: categoryId,
        level: "subcategory",
      });

      for (const subcategory of subcategories) {
        const courses = await Courses.find({
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
      // For subcategories, aggregate from direct courses
      const courses = await Courses.find({
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
  AddCourse,
  DelCourses,
  AddLessonToCourse,
  AddNoteToCourse,
  AddVideoToCourse,
};
