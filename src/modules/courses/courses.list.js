const GenRes = require("../../utils/routers/GenRes");
const Courses = require("./courses.model");
const Likes = require("../likes/likes.model");
const Comments = require("../comments/comments.model");

const ListCourses = async (req, res) => {
  try {
    const page = parseInt(req?.params?.page || "0") || 0;
    const pageSize = 10;
    const lastId = req.query.lastId;
    const search = req.query.search;

    const filters = {};

    // Add search filter if provided
    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Add cursor-based pagination
    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Fetch courses with pagination
    const courses = await Courses.find(filters)
      .sort({ _id: -1 })
      .skip(page * pageSize)
      .limit(pageSize + 1)
      .lean();

    const hasMore = courses.length > pageSize;
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

        return {
          ...course,
          liked: !!liked,
          likes,
          comments,
        };
      })
    );

    const response = GenRes(
      200,
      finalResults,
      null,
      `Retrieved ${finalResults.length} courses`
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = ListCourses;
