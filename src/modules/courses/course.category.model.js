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
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    metadata: {
      totalCourses: {
        type: Number,
        default: 0,
      },
      totalPDFs: {
        type: Number,
        default: 0,
      },
      totalVideos: {
        type: Number,
        default: 0,
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
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
  // This would be populated when needed
  return this.name;
});

// Pre-save middleware to generate slug
CourseCategorySchema.pre("save", function (next) {
  if (this.isModified("name")) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
  next();
});

// Index for better performance
CourseCategorySchema.index({ slug: 1 });
CourseCategorySchema.index({ parentCategory: 1, sortOrder: 1 });
CourseCategorySchema.index({ isActive: 1, sortOrder: 1 });

const CourseCategory =
  models?.CourseCategory || model("CourseCategory", CourseCategorySchema);
module.exports = CourseCategory;
