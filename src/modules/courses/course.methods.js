const Course = require("./course.model");
const Category = require("./category.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

// Get all categories
const GetCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    // Enrich with course statistics
    const enrichedCategories = await Promise.all(
      categories.map(async (category) => {
        const [courseCount, totalLessons, totalNotes, totalVideos] =
          await Promise.all([
            Course.countDocuments({
              "category._id": category._id.toString(),
              isPublished: true,
            }),
            Course.aggregate([
              { $match: { "category._id": category._id.toString() } },
              { $project: { lessonsCount: { $size: "$lessons" } } },
              { $group: { _id: null, total: { $sum: "$lessonsCount" } } },
            ]),
            Course.aggregate([
              { $match: { "category._id": category._id.toString() } },
              { $unwind: "$lessons" },
              { $project: { notesCount: { $size: "$lessons.notes" } } },
              { $group: { _id: null, total: { $sum: "$notesCount" } } },
            ]),
            Course.aggregate([
              { $match: { "category._id": category._id.toString() } },
              { $unwind: "$lessons" },
              { $project: { videosCount: { $size: "$lessons.videos" } } },
              { $group: { _id: null, total: { $sum: "$videosCount" } } },
            ]),
          ]);

        return {
          ...category,
          statistics: {
            courses: courseCount,
            lessons: totalLessons[0]?.total || 0,
            notes: totalNotes[0]?.total || 0,
            videos: totalVideos[0]?.total || 0,
          },
        };
      })
    );

    return res
      .status(200)
      .json(
        GenRes(
          200,
          enrichedCategories,
          null,
          "Categories retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error getting categories:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get courses by category
const GetCoursesByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page = 0, limit = 10 } = req.query;

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

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50);

    // Get category details
    const category = await Category.findById(categoryId).lean();
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

    // Get courses with pagination
    const [courses, total] = await Promise.all([
      Course.find({
        "category._id": categoryId,
        isPublished: true,
      })
        .sort({ createdAt: -1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      Course.countDocuments({
        "category._id": categoryId,
        isPublished: true,
      }),
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          category,
          courses,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum),
            hasMore: (pageNum + 1) * limitNum < total,
          },
        },
        null,
        "Category courses retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error getting courses by category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get course details with lessons
const GetCourseDetails = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { lessonId } = req.query;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Course.findById(courseId).lean();
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    let responseData = {
      course: {
        ...course,
        contentStructure: {
          totalLessons: course.lessons?.length || 0,
          totalNotes:
            course.lessons?.reduce(
              (sum, lesson) => sum + (lesson.notes?.length || 0),
              0
            ) || 0,
          totalVideos:
            course.lessons?.reduce(
              (sum, lesson) => sum + (lesson.videos?.length || 0),
              0
            ) || 0,
        },
      },
      lessons: course.lessons || [],
    };

    if (lessonId) {
      if (!isValidObjectId(lessonId)) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "Invalid lesson ID" },
              "Invalid lesson ID"
            )
          );
      }

      const lesson = course.lessons?.find((l) => l._id.toString() === lessonId);
      if (!lesson) {
        return res
          .status(404)
          .json(
            GenRes(404, null, { error: "Lesson not found" }, "Lesson not found")
          );
      }

      responseData.selectedLesson = lesson;
      responseData.notes = lesson.notes || [];
      responseData.videos = lesson.videos || [];
    }

    return res
      .status(200)
      .json(
        GenRes(200, responseData, null, "Course details retrieved successfully")
      );
  } catch (error) {
    console.error("Error getting course details:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  GetCategories,
  GetCoursesByCategory,
  GetCourseDetails,
};
