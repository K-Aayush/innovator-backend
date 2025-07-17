const Course = require("./courses.model");
const Category = require("./category.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

// Get all categories with course statistics
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
              categoryId: category._id,
              isPublished: true,
            }),
            Course.aggregate([
              { $match: { categoryId: category._id } },
              { $project: { lessonsCount: { $size: "$lessons" } } },
              { $group: { _id: null, total: { $sum: "$lessonsCount" } } },
            ]),
            Course.aggregate([
              { $match: { categoryId: category._id } },
              {
                $project: {
                  lessonNotesCount: {
                    $sum: {
                      $map: {
                        input: "$lessons",
                        as: "lesson",
                        in: { $size: { $ifNull: ["$$lesson.notes", []] } },
                      },
                    },
                  },
                  coursePDFsCount: { $size: { $ifNull: ["$coursePDFs", []] } },
                },
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum: { $add: ["$lessonNotesCount", "$coursePDFsCount"] },
                  },
                },
              },
            ]),
            Course.aggregate([
              { $match: { categoryId: category._id } },
              {
                $project: {
                  lessonVideosCount: {
                    $sum: {
                      $map: {
                        input: "$lessons",
                        as: "lesson",
                        in: { $size: { $ifNull: ["$$lesson.videos", []] } },
                      },
                    },
                  },
                  courseVideosCount: {
                    $size: { $ifNull: ["$courseVideos", []] },
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum: {
                      $add: ["$lessonVideosCount", "$courseVideosCount"],
                    },
                  },
                },
              },
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
        categoryId: categoryId,
        isPublished: true,
      })
        .sort({ createdAt: -1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      Course.countDocuments({
        categoryId: categoryId,
        isPublished: true,
      }),
    ]);

    // Enrich courses with content statistics
    const enrichedCourses = courses.map((course) => ({
      ...course,
      contentStatistics: {
        totalLessons: course.lessons?.length || 0,
        totalLessonVideos:
          course.lessons?.reduce(
            (sum, lesson) => sum + (lesson.videos?.length || 0),
            0
          ) || 0,
        totalLessonNotes:
          course.lessons?.reduce(
            (sum, lesson) => sum + (lesson.notes?.length || 0),
            0
          ) || 0,
        totalCourseVideos: course.courseVideos?.length || 0,
        totalCoursePDFs: course.coursePDFs?.length || 0,
        totalVideos:
          (course.lessons?.reduce(
            (sum, lesson) => sum + (lesson.videos?.length || 0),
            0
          ) || 0) + (course.courseVideos?.length || 0),
        totalPDFs:
          (course.lessons?.reduce(
            (sum, lesson) => sum + (lesson.notes?.length || 0),
            0
          ) || 0) + (course.coursePDFs?.length || 0),
        hasOverviewVideo: !!course.overviewVideo,
        overviewVideoDuration: course.overviewVideoDuration || "00:00:00",
      },
    }));

    return res.status(200).json(
      GenRes(
        200,
        {
          category,
          courses: enrichedCourses,
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

// Get course details with lessons and all content
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

    const course = await Course.findById(courseId)
      .populate("categoryId", "name slug description")
      .lean();

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
        category: course.categoryId, // Populated category data
        contentStructure: {
          totalLessons: course.lessons?.length || 0,
          totalLessonVideos:
            course.lessons?.reduce(
              (sum, lesson) => sum + (lesson.videos?.length || 0),
              0
            ) || 0,
          totalLessonNotes:
            course.lessons?.reduce(
              (sum, lesson) => sum + (lesson.notes?.length || 0),
              0
            ) || 0,
          totalCourseVideos: course.courseVideos?.length || 0,
          totalCoursePDFs: course.coursePDFs?.length || 0,
          totalVideos:
            (course.lessons?.reduce(
              (sum, lesson) => sum + (lesson.videos?.length || 0),
              0
            ) || 0) + (course.courseVideos?.length || 0),
          totalPDFs:
            (course.lessons?.reduce(
              (sum, lesson) => sum + (lesson.notes?.length || 0),
              0
            ) || 0) + (course.coursePDFs?.length || 0),
          hasOverviewVideo: !!course.overviewVideo,
          overviewVideoDuration: course.overviewVideoDuration || "00:00:00",
        },
      },
      lessons: course.lessons || [],
    };

    // If no specific lesson is requested, show all course-level content
    if (!lessonId) {
      responseData.courseVideos = course.courseVideos || [];
      responseData.coursePDFs = course.coursePDFs || [];

      // Also include all lesson content for overview
      responseData.allLessonVideos = [];
      responseData.allLessonNotes = [];

      course.lessons?.forEach((lesson) => {
        if (lesson.videos) {
          responseData.allLessonVideos.push(
            ...lesson.videos.map((video) => ({
              ...video,
              lessonId: lesson._id,
              lessonTitle: lesson.title,
            }))
          );
        }
        if (lesson.notes) {
          responseData.allLessonNotes.push(
            ...lesson.notes.map((note) => ({
              ...note,
              lessonId: lesson._id,
              lessonTitle: lesson.title,
            }))
          );
        }
      });
    } else {
      // If specific lesson is requested, show only that lesson's content
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
      responseData.lessonNotes = lesson.notes || [];
      responseData.lessonVideos = lesson.videos || [];
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
