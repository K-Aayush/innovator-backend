const GenRes = require("../../utils/routers/GenRes");
const Courses = require("./courses.model");
const CourseCategory = require("./course.category.model");
const Likes = require("../likes/likes.model");
const Comments = require("../comments/comments.model");
const { isValidObjectId } = require("mongoose");

const ListCourses = async (req, res) => {
  try {
    const limit = 10;
    const lastId = req.query.lastId;
    const search = req.query.search;
    const categoryId = req.query.categoryId;
    const level = req.query.level;
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder || "desc";

    const filters = { isPublished: true };

    // Add search filter if provided
    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    // Add category filter if provided
    if (categoryId) {
      filters["category._id"] = categoryId;
    }

    // Add level filter if provided
    if (level) {
      filters.level = level;
    }

    // Add cursor-based pagination
    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === "desc" ? -1 : 1;
    if (sortBy !== "_id") {
      sortObj._id = -1; // Secondary sort for consistent pagination
    }

    // Fetch courses with cursor-based pagination
    const courses = await Courses.find(filters)
      .sort(sortObj)
      .limit(limit + 1)
      .lean();

    // Check if there are more items
    const hasMore = courses.length > limit;
    const results = hasMore ? courses.slice(0, -1) : courses;

    // Attach likes and comments count
    const finalResults = await Promise.all(
      results.map(async (course) => {
        const find = { uid: course._id, type: "course" };
        const likes = await Likes.countDocuments(find);
        const comments = await Comments.countDocuments(find);
        const liked = await Likes.findOne({
          ...find,
          "user.email": req.user?.email,
        });

        // Add content type counts
        const pdfCount = course.notes.filter(
          (note) => note.fileType === "pdf"
        ).length;
        const videoCount = course.notes.filter(
          (note) => note.fileType === "video"
        ).length;

        return {
          ...course,
          liked: !!liked,
          likes,
          comments,
          contentCounts: {
            total: course.notes.length,
            pdfs: pdfCount,
            videos: videoCount,
          },
        };
      })
    );

    // Get categories for filtering options
    const categories = await CourseCategory.find({ isActive: true })
      .select("name slug _id")
      .sort({ name: 1 })
      .lean();

    const response = GenRes(
      200,
      {
        courses: finalResults,
        hasMore,
        nextCursor: hasMore ? results[results.length - 1]._id : null,
        filters: {
          categories,
          levels: ["beginner", "intermediate", "advanced"],
          sortOptions: [
            { value: "createdAt", label: "Newest First" },
            { value: "title", label: "Title A-Z" },
            { value: "enrollmentCount", label: "Most Popular" },
            { value: "rating.average", label: "Highest Rated" },
          ],
        },
        appliedFilters: {
          search,
          categoryId,
          level,
          sortBy,
          sortOrder,
        },
      },
      null,
      `Retrieved ${finalResults.length} courses`
    );
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error listing courses:", error);
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

// Get course by ID
const GetCourseById = async (req, res) => {
  try {
    const { id } = req.params;

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

    // Find the course
    const course = await Courses.findById(id).lean();
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Check if course is published (unless user is admin)
    if (!course.isPublished && req.user?.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Course not available" },
            "This course is not published"
          )
        );
    }

    // Get additional course statistics
    const Like = require("../likes/likes.model");
    const Comment = require("../comments/comments.model");

    const [likes, comments] = await Promise.all([
      Like.countDocuments({ uid: course._id, type: "course" }),
      Comment.countDocuments({ uid: course._id, type: "course" }),
    ]);

    // Check if user has liked the course
    let liked = false;
    if (req.user) {
      const userLike = await Like.findOne({
        uid: course._id,
        type: "course",
        "user.email": req.user.email,
      });
      liked = !!userLike;
    }

    // Enhance course data with statistics and content analysis
    const enhancedCourse = {
      ...course,
      statistics: {
        likes,
        comments,
        liked,
        enrollmentCount: course.enrollmentCount || 0,
        rating: course.rating || { average: 0, count: 0 },
      },
      contentAnalysis: {
        totalContent: course.notes ? course.notes.length : 0,
        pdfCount: course.notes
          ? course.notes.filter((note) => note.fileType === "pdf").length
          : 0,
        videoCount: course.notes
          ? course.notes.filter((note) => note.fileType === "video").length
          : 0,
        estimatedDuration: calculateEstimatedDuration(course.notes),
      },
      accessibility: {
        isPublished: course.isPublished,
        level: course.level,
        language: course.language || "English",
        prerequisites: course.prerequisites || [],
        learningOutcomes: course.learningOutcomes || [],
      },
    };

    const response = GenRes(
      200,
      enhancedCourse,
      null,
      "Course retrieved successfully!"
    );
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error getting course:", error);
    const response = GenRes(500, null, { error }, error?.message);
    return res.status(500).json(response);
  }
};

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

module.exports = { ListCourses, GetCourseById };
