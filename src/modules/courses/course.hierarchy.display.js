const GenRes = require("../../utils/routers/GenRes");
const CourseCategory = require("./course.hierarchy.model");
const EnhancedCourse = require("./course.enhanced.model");
const { isValidObjectId } = require("mongoose");

// Get all parent categories for main navigation
const GetParentCategories = async (req, res) => {
  try {
    const parentCategories = await CourseCategory.find({
      level: "parent",
      isActive: true,
    })
      .populate("subcategories", "name slug icon color metadata")
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    // Enrich with statistics
    const enrichedCategories = await Promise.all(
      parentCategories.map(async (category) => {
        const [subcategoryCount, totalCourses, totalNotes, totalVideos] =
          await Promise.all([
            CourseCategory.countDocuments({
              parentCategory: category._id,
              level: "subcategory",
              isActive: true,
            }),
            EnhancedCourse.countDocuments({
              "parentCategory._id": category._id.toString(),
              isPublished: true,
            }),
            EnhancedCourse.aggregate([
              { $match: { "parentCategory._id": category._id.toString() } },
              { $project: { notesCount: { $size: "$notes" } } },
              { $group: { _id: null, total: { $sum: "$notesCount" } } },
            ]),
            EnhancedCourse.aggregate([
              { $match: { "parentCategory._id": category._id.toString() } },
              { $project: { videosCount: { $size: "$videos" } } },
              { $group: { _id: null, total: { $sum: "$videosCount" } } },
            ]),
          ]);

        return {
          ...category,
          statistics: {
            subcategories: subcategoryCount,
            courses: totalCourses,
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
          "Parent categories retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error getting parent categories:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get subcategories under a parent category 
const GetSubcategories = async (req, res) => {
  try {
    const { parentId } = req.params;

    if (!isValidObjectId(parentId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid parent category ID" },
            "Invalid parent category ID"
          )
        );
    }

    const subcategories = await CourseCategory.find({
      parentCategory: parentId,
      level: "subcategory",
      isActive: true,
    })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    // Enrich with course statistics
    const enrichedSubcategories = await Promise.all(
      subcategories.map(async (subcategory) => {
        const [courseCount, totalNotes, totalVideos, totalLessons] =
          await Promise.all([
            EnhancedCourse.countDocuments({
              "subcategory._id": subcategory._id.toString(),
              isPublished: true,
            }),
            EnhancedCourse.aggregate([
              { $match: { "subcategory._id": subcategory._id.toString() } },
              { $project: { notesCount: { $size: "$notes" } } },
              { $group: { _id: null, total: { $sum: "$notesCount" } } },
            ]),
            EnhancedCourse.aggregate([
              { $match: { "subcategory._id": subcategory._id.toString() } },
              { $project: { videosCount: { $size: "$videos" } } },
              { $group: { _id: null, total: { $sum: "$videosCount" } } },
            ]),
            EnhancedCourse.aggregate([
              { $match: { "subcategory._id": subcategory._id.toString() } },
              { $project: { lessonsCount: { $size: "$lessons" } } },
              { $group: { _id: null, total: { $sum: "$lessonsCount" } } },
            ]),
          ]);

        return {
          ...subcategory,
          statistics: {
            courses: courseCount,
            notes: totalNotes[0]?.total || 0,
            videos: totalVideos[0]?.total || 0,
            lessons: totalLessons[0]?.total || 0,
          },
        };
      })
    );

    return res
      .status(200)
      .json(
        GenRes(
          200,
          enrichedSubcategories,
          null,
          "Subcategories retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error getting subcategories:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get courses under a subcategory with lesson structure
const GetSubcategoryCourses = async (req, res) => {
  try {
    const { subcategoryId } = req.params;
    const { page = 0, limit = 10 } = req.query;

    if (!isValidObjectId(subcategoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid subcategory ID" },
            "Invalid subcategory ID"
          )
        );
    }

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50);

    // Get subcategory details
    const subcategory = await CourseCategory.findById(subcategoryId).lean();
    if (!subcategory) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Subcategory not found" },
            "Subcategory not found"
          )
        );
    }

    // Get courses with pagination
    const [courses, total] = await Promise.all([
      EnhancedCourse.find({
        "subcategory._id": subcategoryId,
        isPublished: true,
      })
        .sort({ createdAt: -1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      EnhancedCourse.countDocuments({
        "subcategory._id": subcategoryId,
        isPublished: true,
      }),
    ]);

    // Enrich courses with structured content
    const enrichedCourses = courses.map((course) => ({
      ...course,
      contentStructure: {
        totalLessons: course.lessons?.length || 0,
        totalNotes: course.notes?.length || 0,
        totalVideos: course.videos?.length || 0,
        generalNotes:
          course.notes?.filter((note) => !note.lessonId).length || 0,
        generalVideos:
          course.videos?.filter((video) => !video.lessonId).length || 0,
      },
    }));

    return res.status(200).json(
      GenRes(
        200,
        {
          subcategory,
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
        "Subcategory courses retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error getting subcategory courses:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get course details with lesson-based content organization
const GetCourseWithLessons = async (req, res) => {
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

    const course = await EnhancedCourse.findById(courseId).lean();
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
          totalNotes: course.notes?.length || 0,
          totalVideos: course.videos?.length || 0,
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
      responseData.notes =
        course.notes?.filter(
          (note) => note.lessonId && note.lessonId.toString() === lessonId
        ) || [];
      responseData.videos =
        course.videos?.filter(
          (video) => video.lessonId && video.lessonId.toString() === lessonId
        ) || [];
    } else {
      // Show all content when no lesson is selected
      responseData.notes = course.notes || [];
      responseData.videos = course.videos || [];
      responseData.selectedLesson = null;
    }

    return res
      .status(200)
      .json(
        GenRes(200, responseData, null, "Course details retrieved successfully")
      );
  } catch (error) {
    console.error("Error getting course with lessons:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get notes by parent category (Notes tab functionality)
const GetNotesByParentCategory = async (req, res) => {
  try {
    const { parentId } = req.params;
    const { subcategoryId } = req.query;

    if (!isValidObjectId(parentId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid parent category ID" },
            "Invalid parent category ID"
          )
        );
    }

    if (subcategoryId) {
      // Get notes for specific subcategory
      if (!isValidObjectId(subcategoryId)) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "Invalid subcategory ID" },
              "Invalid subcategory ID"
            )
          );
      }

      const subcategory = await CourseCategory.findById(subcategoryId).lean();
      if (!subcategory) {
        return res
          .status(404)
          .json(
            GenRes(
              404,
              null,
              { error: "Subcategory not found" },
              "Subcategory not found"
            )
          );
      }

      // Get all notes from courses in this subcategory
      const courses = await EnhancedCourse.find({
        "subcategory._id": subcategoryId,
        isPublished: true,
      })
        .select("title notes lessons")
        .lean();

      const allNotes = [];
      courses.forEach((course) => {
        course.notes?.forEach((note) => {
          const lessonInfo = note.lessonId
            ? course.lessons?.find(
                (l) => l._id.toString() === note.lessonId.toString()
              )
            : null;

          allNotes.push({
            ...note,
            courseTitle: course.title,
            courseId: course._id,
            lessonTitle: lessonInfo?.title || "General",
            category: "note",
          });
        });
      });

      return res.status(200).json(
        GenRes(
          200,
          {
            subcategory,
            notes: allNotes.sort((a, b) => a.sortOrder - b.sortOrder),
            totalNotes: allNotes.length,
          },
          null,
          "Subcategory notes retrieved successfully"
        )
      );
    } else {
      // Get note subcategories under parent category
      const subcategories = await CourseCategory.find({
        parentCategory: parentId,
        level: "subcategory",
        isActive: true,
      })
        .sort({ sortOrder: 1, name: 1 })
        .lean();

      // Enrich with note counts
      const enrichedSubcategories = await Promise.all(
        subcategories.map(async (subcategory) => {
          const noteCount = await EnhancedCourse.aggregate([
            { $match: { "subcategory._id": subcategory._id.toString() } },
            { $project: { notesCount: { $size: "$notes" } } },
            { $group: { _id: null, total: { $sum: "$notesCount" } } },
          ]);

          return {
            ...subcategory,
            noteCount: noteCount[0]?.total || 0,
            type: "note_subcategory",
          };
        })
      );

      return res.status(200).json(
        GenRes(
          200,
          {
            noteSubcategories: enrichedSubcategories,
            totalSubcategories: enrichedSubcategories.length,
          },
          null,
          "Note subcategories retrieved successfully"
        )
      );
    }
  } catch (error) {
    console.error("Error getting notes by parent category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get comprehensive category hierarchy
const GetCategoryHierarchy = async (req, res) => {
  try {
    const hierarchy = await CourseCategory.aggregate([
      {
        $match: {
          level: "parent",
          isActive: true,
        },
      },
      {
        $lookup: {
          from: "coursecategories",
          localField: "_id",
          foreignField: "parentCategory",
          as: "subcategories",
          pipeline: [
            { $match: { level: "subcategory", isActive: true } },
            { $sort: { sortOrder: 1, name: 1 } },
          ],
        },
      },
      {
        $sort: { sortOrder: 1, name: 1 },
      },
    ]);

    // Enrich with course counts
    const enrichedHierarchy = await Promise.all(
      hierarchy.map(async (parent) => {
        const enrichedSubcategories = await Promise.all(
          parent.subcategories.map(async (sub) => {
            const courseCount = await EnhancedCourse.countDocuments({
              "subcategory._id": sub._id.toString(),
              isPublished: true,
            });
            return { ...sub, courseCount };
          })
        );

        const totalCourses = enrichedSubcategories.reduce(
          (sum, sub) => sum + sub.courseCount,
          0
        );

        return {
          ...parent,
          subcategories: enrichedSubcategories,
          totalCourses,
        };
      })
    );

    return res
      .status(200)
      .json(
        GenRes(
          200,
          enrichedHierarchy,
          null,
          "Category hierarchy retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error getting category hierarchy:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  GetParentCategories,
  GetSubcategories,
  GetSubcategoryCourses,
  GetCourseWithLessons,
  GetNotesByParentCategory,
  GetCategoryHierarchy,
};
