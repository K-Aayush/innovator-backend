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

    // Validate category
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

    const category = await CourseCategory.findById(data.categoryId);
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

    // Process notes and determine file types with video duration extraction
    const processedNotes = await Promise.all(
      (data.notes || []).map(async (note, index) => {
        let fileType = "other";
        let duration = null;
        let metadata = {};

        if (note.pdf) {
          const ext = path.extname(note.pdf).toLowerCase();
          const videoExtensions = [
            ".mp4",
            ".avi",
            ".mov",
            ".wmv",
            ".flv",
            ".webm",
            ".mkv",
          ];

          if (note.pdf.toLowerCase().endsWith(".pdf")) {
            fileType = "pdf";
          } else if (videoExtensions.includes(ext)) {
            fileType = "video";

            // Extract video duration and metadata
            try {
              const videoPath = path.join(process.cwd(), note.pdf.substring(1));
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
                  `Extracted video metadata for ${note.name}:`,
                  metadata
                );
              }
            } catch (error) {
              console.error(
                `Error extracting video metadata for ${note.name}:`,
                error
              );
              duration = "00:00:00"; // Default duration
            }
          }
        }

        return {
          ...note,
          fileType,
          duration,
          metadata,
          sortOrder: note.sortOrder || index,
        };
      })
    );

    const courseData = {
      ...data,
      category: {
        _id: category._id.toString(),
        name: category.name,
        slug: category.slug,
      },
      author: {
        email: author?.email,
        phone: author?.phone || "Not provided",
        _id: author?._id,
      },
      notes: processedNotes,
    };

    // Remove categoryId from courseData as we've processed it
    delete courseData.categoryId;

    const newCourse = new Courses(courseData);
    await newCourse.save();

    // Update category metadata
    await updateCategoryMetadata(category._id);

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

    const categoryId = course.category._id;

    // Delete associated files
    if (course.notes && course.notes.length > 0) {
      const failedFiles = [];
      for (const note of course.notes) {
        if (note.pdf) {
          try {
            const filePath = path.join(process.cwd(), note.pdf.slice(1));
            fs.unlinkSync(filePath);
          } catch (error) {
            console.log(`Failed to delete file ${note.pdf}:`, error?.message);
            failedFiles.push(note.pdf);
          }
        }
      }
      if (failedFiles.length > 0) {
        console.log("Some files failed to delete:", failedFiles);
      }
    }

    await Courses.findOneAndDelete({ _id });

    // Update category metadata
    await updateCategoryMetadata(categoryId);

    const response = GenRes(200, null, null, "Course deleted successfully!");
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error deleting course:", error);
    const response = GenRes(500, null, { error }, error?.message);
    return res.status(500).json(response);
  }
};

// Helper function to update category metadata
async function updateCategoryMetadata(categoryId) {
  try {
    const courses = await Courses.find({ "category._id": categoryId });

    let totalPDFs = 0;
    let totalVideos = 0;
    let totalDuration = 0; // in seconds

    courses.forEach((course) => {
      course.notes.forEach((note) => {
        if (note.fileType === "pdf") {
          totalPDFs++;
        } else if (note.fileType === "video") {
          totalVideos++;
          if (note.metadata?.durationSeconds) {
            totalDuration += note.metadata.durationSeconds;
          }
        }
      });
    });

    await CourseCategory.findByIdAndUpdate(categoryId, {
      $set: {
        "metadata.totalCourses": courses.length,
        "metadata.totalPDFs": totalPDFs,
        "metadata.totalVideos": totalVideos,
        "metadata.totalDuration": totalDuration,
        "metadata.lastUpdated": new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating category metadata:", error);
  }
}

module.exports = { AddCourse, DelCourses };
