const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

// Course Category Schema
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
    image: String,
    bannerImage: String,

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

    // Category level: parent or subcategory only
    level: {
      type: String,
      enum: ["parent", "subcategory"],
      default: "parent",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },

    // Enhanced metadata
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

// Pre-save middleware
CourseCategorySchema.pre("save", function (next) {
  if (this.isModified("name")) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // Auto-set level based on parent
  if (this.parentCategory && this.level === "parent") {
    this.level = "subcategory";
  }

  next();
});

CourseCategorySchema.index({ slug: 1 });
CourseCategorySchema.index({ parentCategory: 1, sortOrder: 1 });
CourseCategorySchema.index({ level: 1, isActive: 1 });
CourseCategorySchema.index({ "createdBy._id": 1 });

const CourseCategory =
  models?.CourseCategory || model("CourseCategory", CourseCategorySchema);
module.exports = CourseCategory;
