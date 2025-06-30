const CourseCategory = require("./course.category.model");
const Course = require("./courses.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

// Create a new course category (Admin only)
const CreateCourseCategory = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can create course categories"
          )
        );
    }

    const { name, description, icon, color, parentCategory, sortOrder } =
      req.body;

    if (!name) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Category name is required" },
            "Please provide a category name"
          )
        );
    }

    // Check if category with same name already exists
    const existingCategory = await CourseCategory.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
    });

    if (existingCategory) {
      return res
        .status(409)
        .json(
          GenRes(
            409,
            null,
            { error: "Category already exists" },
            "A category with this name already exists"
          )
        );
    }

    // Validate parent category if provided
    if (parentCategory && !isValidObjectId(parentCategory)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid parent category" },
            "Invalid parent category ID"
          )
        );
    }

    if (parentCategory) {
      const parent = await CourseCategory.findById(parentCategory);
      if (!parent) {
        return res
          .status(404)
          .json(
            GenRes(
              404,
              null,
              { error: "Parent category not found" },
              "Parent category not found"
            )
          );
      }
    }

    const categoryData = {
      name,
      description,
      icon,
      color: color || "#4A90E2",
      parentCategory: parentCategory || null,
      sortOrder: sortOrder || 0,
      createdBy: {
        _id: req.user._id,
        email: req.user.email,
        name: req.user.name || req.user.email,
      },
    };

    const newCategory = new CourseCategory(categoryData);
    await newCategory.save();

    // Update parent category's subcategories array
    if (parentCategory) {
      await CourseCategory.findByIdAndUpdate(parentCategory, {
        $addToSet: { subcategories: newCategory._id },
      });
    }

    return res
      .status(201)
      .json(
        GenRes(201, newCategory, null, "Course category created successfully")
      );
  } catch (error) {
    console.error("Error creating course category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get all course categories with hierarchy
const GetCourseCategories = async (req, res) => {
  try {
    const { includeInactive = false, parentOnly = false } = req.query;

    const filters = {};
    if (!includeInactive) {
      filters.isActive = true;
    }
    if (parentOnly === "true") {
      filters.parentCategory = null;
    }

    const categories = await CourseCategory.find(filters)
      .populate("subcategories", "name slug icon color metadata")
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    // Calculate course counts for each category
    const enrichedCategories = await Promise.all(
      categories.map(async (category) => {
        const courseCount = await Course.countDocuments({
          "category._id": category._id.toString(),
        });

        // Count PDFs and Videos in courses
        const courses = await Course.find({
          "category._id": category._id.toString(),
        }).select("notes");

        let pdfCount = 0;
        let videoCount = 0;

        courses.forEach((course) => {
          course.notes.forEach((note) => {
            if (note.pdf) {
              if (note.pdf.toLowerCase().endsWith(".pdf")) {
                pdfCount++;
              } else if (isVideoFile(note.pdf)) {
                videoCount++;
              }
            }
          });
        });

        return {
          ...category,
          metadata: {
            ...category.metadata,
            totalCourses: courseCount,
            totalPDFs: pdfCount,
            totalVideos: videoCount,
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
          "Course categories retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error getting course categories:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get courses by category with PDF/Video separation
const GetCoursesByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const {
      contentType = "all",
      page = 0,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

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

    const category = await CourseCategory.findById(categoryId).lean();
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

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50);
    const sortDirection = sortOrder === "desc" ? -1 : 1;

    // Get courses in this category
    const courses = await Course.find({
      "category._id": categoryId,
    })
      .sort({ [sortBy]: sortDirection })
      .lean();

    let processedContent = [];

    if (contentType === "all" || contentType === "courses") {
      // Return full courses
      processedContent = courses.map((course) => ({
        ...course,
        contentType: "course",
        pdfCount: course.notes.filter(
          (note) => note.pdf && note.pdf.toLowerCase().endsWith(".pdf")
        ).length,
        videoCount: course.notes.filter(
          (note) => note.pdf && isVideoFile(note.pdf)
        ).length,
      }));
    } else if (contentType === "pdfs") {
      // Extract and return PDFs from all courses
      courses.forEach((course) => {
        course.notes.forEach((note) => {
          if (note.pdf && note.pdf.toLowerCase().endsWith(".pdf")) {
            processedContent.push({
              _id: note._id,
              name: note.name,
              pdf: note.pdf,
              premium: note.premium,
              contentType: "pdf",
              course: {
                _id: course._id,
                title: course.title,
                thumbnail: course.thumbnail,
              },
              category: course.category,
              createdAt: course.createdAt,
            });
          }
        });
      });
    } else if (contentType === "videos") {
      // Extract and return videos from all courses
      courses.forEach((course) => {
        course.notes.forEach((note) => {
          if (note.pdf && isVideoFile(note.pdf)) {
            processedContent.push({
              _id: note._id,
              name: note.name,
              video: note.pdf,
              premium: note.premium,
              contentType: "video",
              course: {
                _id: course._id,
                title: course.title,
                thumbnail: course.thumbnail,
              },
              category: course.category,
              createdAt: course.createdAt,
              thumbnail: generateVideoThumbnail(note.pdf),
              duration: getVideoDuration(note.pdf),
            });
          }
        });
      });
    }

    // Apply pagination
    const startIndex = pageNum * limitNum;
    const endIndex = startIndex + limitNum;
    const paginatedContent = processedContent.slice(startIndex, endIndex);

    return res.status(200).json(
      GenRes(
        200,
        {
          category,
          content: paginatedContent,
          contentType,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: processedContent.length,
            pages: Math.ceil(processedContent.length / limitNum),
            hasMore: endIndex < processedContent.length,
          },
          statistics: {
            totalCourses: courses.length,
            totalPDFs: processedContent.filter(
              (item) => item.contentType === "pdf"
            ).length,
            totalVideos: processedContent.filter(
              (item) => item.contentType === "video"
            ).length,
          },
        },
        null,
        `Retrieved ${paginatedContent.length} items from ${category.name} category`
      )
    );
  } catch (error) {
    console.error("Error getting courses by category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update course category (Admin only)
const UpdateCourseCategory = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update course categories"
          )
        );
    }

    const { categoryId } = req.params;
    const updateData = req.body;

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

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.createdBy;
    delete updateData.metadata;
    delete updateData.subcategories;

    const updatedCategory = await CourseCategory.findByIdAndUpdate(
      categoryId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedCategory) {
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

    return res
      .status(200)
      .json(
        GenRes(
          200,
          updatedCategory,
          null,
          "Course category updated successfully"
        )
      );
  } catch (error) {
    console.error("Error updating course category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete course category (Admin only)
const DeleteCourseCategory = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete course categories"
          )
        );
    }

    const { categoryId } = req.params;

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

    // Check if category has courses
    const courseCount = await Course.countDocuments({
      "category._id": categoryId,
    });

    if (courseCount > 0) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Category has courses" },
            "Cannot delete category that contains courses"
          )
        );
    }

    // Check if category has subcategories
    const subcategoryCount = await CourseCategory.countDocuments({
      parentCategory: categoryId,
    });

    if (subcategoryCount > 0) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Category has subcategories" },
            "Cannot delete category that has subcategories"
          )
        );
    }

    const deletedCategory = await CourseCategory.findByIdAndDelete(categoryId);

    if (!deletedCategory) {
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

    // Remove from parent's subcategories array if it was a subcategory
    if (deletedCategory.parentCategory) {
      await CourseCategory.findByIdAndUpdate(deletedCategory.parentCategory, {
        $pull: { subcategories: categoryId },
      });
    }

    return res
      .status(200)
      .json(GenRes(200, null, null, "Course category deleted successfully"));
  } catch (error) {
    console.error("Error deleting course category:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get category hierarchy (for dropdowns, navigation, etc.)
const GetCategoryHierarchy = async (req, res) => {
  try {
    const categories = await CourseCategory.find({ isActive: true })
      .populate("subcategories", "name slug icon color")
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    // Build hierarchy tree
    const hierarchy = buildCategoryTree(categories);

    return res
      .status(200)
      .json(
        GenRes(
          200,
          hierarchy,
          null,
          "Category hierarchy retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error getting category hierarchy:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Helper function to build category tree
function buildCategoryTree(categories) {
  const categoryMap = new Map();
  const rootCategories = [];

  // Create a map of all categories
  categories.forEach((category) => {
    categoryMap.set(category._id.toString(), { ...category, children: [] });
  });

  // Build the tree structure
  categories.forEach((category) => {
    if (category.parentCategory) {
      const parent = categoryMap.get(category.parentCategory.toString());
      if (parent) {
        parent.children.push(categoryMap.get(category._id.toString()));
      }
    } else {
      rootCategories.push(categoryMap.get(category._id.toString()));
    }
  });

  return rootCategories;
}

// Helper function to check if file is video
function isVideoFile(filePath) {
  const videoExtensions = [
    ".mp4",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".mkv",
  ];
  const ext = require("path").extname(filePath).toLowerCase();
  return videoExtensions.includes(ext);
}

// Helper function to generate video thumbnail
function generateVideoThumbnail(videoPath) {
  const basePath = videoPath.replace(/\.[^/.]+$/, "");
  return `${basePath}_thumbnail.jpg`;
}

module.exports = {
  CreateCourseCategory,
  GetCourseCategories,
  GetCoursesByCategory,
  UpdateCourseCategory,
  DeleteCourseCategory,
  GetCategoryHierarchy,
};
