const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const CategorySchema = new Schema(
  {
    name: gen.required(String),
    description: String,
    slug: gen.unique(String),
    icon: String,
    color: {
      type: String,
      default: "#4A90E2",
    },
    thumbnail: String,

    // Category status
    isActive: {
      type: Boolean,
      default: true,
    },

    // Sorting and organization
    sortOrder: {
      type: Number,
      default: 0,
    },

    // SEO and metadata
    seoTitle: String,
    seoDescription: String,
    keywords: [String],

    // Admin info
    createdBy: {
      _id: gen.required(String),
      email: gen.required(String),
      name: String,
    },

    statistics: {
      totalCourses: {
        type: Number,
        default: 0,
      },
      totalStudents: {
        type: Number,
        default: 0,
      },
      totalLessons: {
        type: Number,
        default: 0,
      },
      totalVideos: {
        type: Number,
        default: 0,
      },
      totalNotes: {
        type: Number,
        default: 0,
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

CategorySchema.pre("save", function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
  next();
});

CategorySchema.index({ slug: 1 });
CategorySchema.index({ isActive: 1, sortOrder: 1 });
CategorySchema.index({ name: "text", description: "text" });

const Category = models?.Category || model("Category", CategorySchema);
module.exports = Category;
