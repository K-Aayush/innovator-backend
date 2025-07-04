const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const CourseRatingSchema = new Schema(
  {
    course: {
      _id: gen.required(String),
      title: gen.required(String),
      author: {
        _id: gen.required(String),
        email: gen.required(String),
      },
    },
    student: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
      picture: String,
    },
    rating: gen.required(Number, { min: 1, max: 5 }),
    review: {
      title: String,
      content: String,
      pros: [String],
      cons: [String],
    },
    helpful: {
      count: { type: Number, default: 0 },
      users: [String], 
    },
    verified: { type: Boolean, default: false }, 
    courseProgress: {
      completionPercentage: { type: Number, default: 0 },
      timeSpent: { type: Number, default: 0 },
    },
    metadata: {
      deviceType: String,
      platform: String,
      courseVersion: String,
    },
    status: {
      type: String,
      enum: ["active", "hidden", "flagged", "deleted"],
      default: "active",
    },
    adminResponse: {
      content: String,
      respondedBy: String,
      respondedAt: Date,
    },
  },
  {
    timestamps: true,
    indexes: [
      { "course._id": 1, rating: -1 },
      { "student._id": 1 },
      { rating: -1, createdAt: -1 },
      { "course._id": 1, "student._id": 1 },
    ],
  }
);

// Compound unique index to prevent duplicate ratings from same user
CourseRatingSchema.index(
  { "course._id": 1, "student._id": 1 },
  { unique: true }
);

// Virtual for rating display
CourseRatingSchema.virtual("ratingDisplay").get(function () {
  return "★".repeat(this.rating) + "☆".repeat(5 - this.rating);
});

// Virtual for time since rating
CourseRatingSchema.virtual("timeSinceRating").get(function () {
  const now = new Date();
  const diffTime = Math.abs(now - this.createdAt);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
});

const CourseRating =
  models?.CourseRating || model("CourseRating", CourseRatingSchema);
module.exports = CourseRating;
