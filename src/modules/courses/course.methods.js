const Course = require("./courses.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

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

    // Enrich with course statistics
    const enrichedCategories = await Promise.all(
      categories.map(async (category) => {
        const [totalLessons, totalNotes, totalVideos] = await Promise.all([
          Course.aggregate([
            { $match: { "category.slug": category.slug } },
            { $project: { lessonsCount: { $size: "$lessons" } } },
            { $group: { _id: null, total: { $sum: "$lessonsCount" } } },
          ]),
          Course.aggregate([
            { $match: { "category.slug": category.slug } },
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
            { $match: { "category.slug": category.slug } },
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
            courses: category.courseCount,
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
    const { categorySlug } = req.params;
    const { page = 0, limit = 10 } = req.query;

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50);

    // Get courses with pagination
    const [courses, total] = await Promise.all([
      Course.find({
        "category.slug": categorySlug,
        isPublished: true,
      })
        .sort({ createdAt: -1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      Course.countDocuments({
        "category.slug": categorySlug,
        isPublished: true,
      }),
    ]);

    if (courses.length === 0) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "No courses found" },
            "No courses found for this category"
          )
        );
    }

    // Get category info from first course
    const category = courses[0].category;

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
      courseVideos: course.courseVideos || [], 
      coursePDFs: course.coursePDFs || [],
    };

    // If lessonId is provided, return only that lesson's content
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

      // Return only the selected lesson's content
      responseData = {
        course: {
          _id: course._id,
          title: course.title,
          description: course.description,
          thumbnail: course.thumbnail,
          category: course.category,
          instructor: course.instructor,
        },
        selectedLesson: lesson,
        lessonNotes: lesson.notes || [],
        lessonVideos: lesson.videos || [],

        courseVideos: [],
        coursePDFs: [],
        lessons: course.lessons || [],
      };
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
