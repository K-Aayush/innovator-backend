const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const Courses = require("./courses.model");
const CourseCategory = require("./course.category.model");
const path = require("path");

// Update course (Admin only)
const UpdateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // Check if user is admin
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

    if (!id || !isValidObjectId(id)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid course ID" },
            "Please provide a valid course ID"
          )
        );
    }

    // Find the existing course
    const existingCourse = await Courses.findById(id);
    if (!existingCourse) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Validate category if provided
    if (data.categoryId) {
      if (!isValidObjectId(data.categoryId)) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "Invalid category ID" },
              "Please provide a valid category ID"
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

      // Update category information
      existingCourse.category = {
        _id: category._id.toString(),
        name: category.name,
        slug: category.slug,
      };
    }

    // Update basic course information
    if (data.title) existingCourse.title = data.title;
    if (data.description) existingCourse.description = data.description;
    if (data.thumbnail) existingCourse.thumbnail = data.thumbnail;
    if (data.level) existingCourse.level = data.level;
    if (data.duration) existingCourse.duration = data.duration;
    if (data.language) existingCourse.language = data.language;
    if (data.isPublished !== undefined)
      existingCourse.isPublished = data.isPublished;

    // Update price if provided
    if (data.price) {
      if (data.price.usd !== undefined)
        existingCourse.price.usd = data.price.usd;
      if (data.price.npr !== undefined)
        existingCourse.price.npr = data.price.npr;
    }

    // Update arrays if provided
    if (data.tags)
      existingCourse.tags = Array.isArray(data.tags) ? data.tags : [];
    if (data.prerequisites)
      existingCourse.prerequisites = Array.isArray(data.prerequisites)
        ? data.prerequisites
        : [];
    if (data.learningOutcomes)
      existingCourse.learningOutcomes = Array.isArray(data.learningOutcomes)
        ? data.learningOutcomes
        : [];

    // Update notes if provided
    if (data.notes && Array.isArray(data.notes)) {
      // Process notes and determine file types
      const processedNotes = data.notes.map((note, index) => {
        let fileType = "other";
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
          }
        }

        return {
          ...note,
          fileType,
          sortOrder: note.sortOrder !== undefined ? note.sortOrder : index,
        };
      });

      existingCourse.notes = processedNotes;
    }

    // Save the updated course
    await existingCourse.save();

    if (data.categoryId) {
      await updateCategoryMetadata(data.categoryId);

      if (existingCourse.category._id !== data.categoryId) {
        await updateCategoryMetadata(existingCourse.category._id);
      }
    }

    const response = GenRes(
      200,
      existingCourse.toObject(),
      null,
      "Course updated successfully!"
    );
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error updating course:", error);
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

    courses.forEach((course) => {
      course.notes.forEach((note) => {
        if (note.fileType === "pdf") {
          totalPDFs++;
        } else if (note.fileType === "video") {
          totalVideos++;
        }
      });
    });

    await CourseCategory.findByIdAndUpdate(categoryId, {
      $set: {
        "metadata.totalCourses": courses.length,
        "metadata.totalPDFs": totalPDFs,
        "metadata.totalVideos": totalVideos,
        "metadata.lastUpdated": new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating category metadata:", error);
  }
}

// Helper function to calculate estimated duration
function calculateEstimatedDuration(notes) {
  if (!notes || !Array.isArray(notes)) return "0 hours";

  let totalMinutes = 0;

  notes.forEach((note) => {
    if (note.fileType === "pdf") {
      totalMinutes += 5;
    } else if (note.fileType === "video") {
      if (note.duration) {
        if (typeof note.duration === "string" && note.duration.includes(":")) {
          const [minutes, seconds] = note.duration.split(":").map(Number);
          totalMinutes += minutes + seconds / 60;
        } else {
          totalMinutes += parseInt(note.duration) || 10;
        }
      } else {
        totalMinutes += 10;
      }
    } else {
      totalMinutes += 3;
    }
  });

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);

  if (hours > 0) {
    return `${hours} hour${hours > 1 ? "s" : ""} ${
      minutes > 0 ? `${minutes} min` : ""
    }`;
  } else {
    return `${minutes} minutes`;
  }
}

module.exports = {
  UpdateCourse,
};
