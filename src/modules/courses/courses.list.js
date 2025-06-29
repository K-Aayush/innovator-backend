const GenRes = require("../../utils/routers/GenRes");
const Courses = require("./courses.model");
const CourseCategory = require("./course.category.model");
const Likes = require("../likes/likes.model");
const Comments = require("../comments/comments.model");

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

module.exports = ListCourses;
