const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const CourseCategorySchema = new Schema(
  {
    name: gen.required(String),
    description: String,
    slug: gen.unique(String),
    icon: String,
    color: {
      type: String,
      default: "#4A90E2",
    },

    // Hierarchy support
    parentCategory: {
      type: Schema.Types.ObjectId,
      ref: "CourseCategory",
      default: null,
    },
    subcategories: [
      {
        type: Schema.Types.ObjectId,
        ref: "CourseCategory",
      },
    ],

    // Category level: parent, subcategory, lesson
    level: {
      type: String,
      enum: ["parent", "subcategory", "lesson"],
      default: "parent",
    },

    // For lesson-level categories
    courseId: {
      type: Schema.Types.ObjectId,
      ref: "Course",
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },

    // Enhanced metadata for different levels
    metadata: {
      totalCourses: {
        type: Number,
        default: 0,
      },
      totalSubcategories: {
        type: Number,
        default: 0,
      },
      totalLessons: {
        type: Number,
        default: 0,
      },
      totalNotes: {
        type: Number,
        default: 0,
      },
      totalVideos: {
        type: Number,
        default: 0,
      },
      totalDuration: {
        type: Number,
        default: 0,
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
    },

    // Display preferences
    displaySettings: {
      showInNavigation: {
        type: Boolean,
        default: true,
      },
      featuredOrder: Number,
      thumbnailImage: String,
      bannerImage: String,
    },

    createdBy: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for full category path
CourseCategorySchema.virtual("fullPath").get(function () {
  return this.name;
});

// Virtual for hierarchy level display
CourseCategorySchema.virtual("levelDisplay").get(function () {
  const levelMap = {
    parent: "Main Category",
    subcategory: "Technology",
    lesson: "Lesson",
  };
  return levelMap[this.level] || "Unknown";
});

// Pre-save middleware to generate slug and handle hierarchy
CourseCategorySchema.pre("save", function (next) {
  if (this.isModified("name")) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // Auto-set level based on parent
  if (this.parentCategory && !this.level) {
    this.level = "subcategory";
  }

  next();
});

// Indexes for better performance
CourseCategorySchema.index({ slug: 1 });
CourseCategorySchema.index({ parentCategory: 1, sortOrder: 1 });
CourseCategorySchema.index({ level: 1, isActive: 1 });
CourseCategorySchema.index({ "createdBy._id": 1 });

const CourseCategory =
  models?.CourseCategory || model("CourseCategory", CourseCategorySchema);
module.exports = CourseCategory;
