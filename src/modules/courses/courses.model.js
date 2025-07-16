const { Schema, models, model } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

// Note Schema
const NoteSchema = new Schema({
  title: gen.required(String),
  description: String,
  fileUrl: gen.required(String),
  fileType: {
    type: String,
    enum: ["pdf", "document", "text"],
    default: "pdf",
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  metadata: {
    fileSize: String,
    downloadCount: {
      type: Number,
      default: 0,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
});

// Video Schema
const VideoSchema = new Schema({
  title: gen.required(String),
  description: String,
  videoUrl: gen.required(String),
  thumbnail: String,
  duration: String,
  sortOrder: {
    type: Number,
    default: 0,
  },
  metadata: {
    quality: String,
    fileSize: String,
    viewCount: {
      type: Number,
      default: 0,
    },
    durationSeconds: Number,
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
});

// Lesson Schema
const LessonSchema = new Schema({
  title: gen.required(String),
  description: String,
  sortOrder: {
    type: Number,
    default: 0,
  },
  duration: String,
  isPublished: {
    type: Boolean,
    default: true,
  },
  notes: [NoteSchema],
  videos: [VideoSchema],
  metadata: {
    estimatedTime: Number,
    difficulty: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
  },
});

const CourseSchema = new Schema(
  {
    title: gen.required(String),
    description: gen.required(String),
    overview: String,

    // Pricing
    price: gen.required({
      usd: gen.required(Number),
      npr: gen.required(Number),
    }),

    // Media
    thumbnail: gen.required(String),
    overviewVideo: String,

    // Single category like Udemy
    category: {
      _id: gen.required(String),
      name: gen.required(String),
      slug: String,
    },

    lessons: [LessonSchema],

    // Course metadata
    instructor: {
      name: String,
      bio: String,
      picture: String,
      credentials: [String],
    },

    author: gen.required({
      email: gen.required(String),
      _id: gen.required(String),
      phone: String,
    }),

    // Course details
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    duration: String,
    language: {
      type: String,
      default: "English",
    },

    // Course content
    tags: [String],
    prerequisites: [String],
    learningOutcomes: [String],
    targetAudience: [String],

    // Status
    isPublished: {
      type: Boolean,
      default: true,
    },

    // Analytics
    enrollmentCount: {
      type: Number,
      default: 0,
    },
    rating: {
      average: {
        type: Number,
        default: 0,
      },
      count: {
        type: Number,
        default: 0,
      },
    },

    // Course settings
    settings: {
      allowDownloads: {
        type: Boolean,
        default: false,
      },
      certificateEnabled: {
        type: Boolean,
        default: true,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for total content count
CourseSchema.virtual("totalContent").get(function () {
  let total = 0;
  this.lessons?.forEach((lesson) => {
    total += (lesson.notes?.length || 0) + (lesson.videos?.length || 0);
  });
  return total;
});

// Virtual for lesson count
CourseSchema.virtual("lessonCount").get(function () {
  return this.lessons?.length || 0;
});

// Pre-save middleware
CourseSchema.pre("save", function (next) {
  // Sort lessons by sortOrder
  if (this.lessons) {
    this.lessons.sort((a, b) => a.sortOrder - b.sortOrder);

    // Sort notes and videos within each lesson
    this.lessons.forEach((lesson) => {
      if (lesson.notes) {
        lesson.notes.sort((a, b) => a.sortOrder - b.sortOrder);
      }
      if (lesson.videos) {
        lesson.videos.sort((a, b) => a.sortOrder - b.sortOrder);
      }
    });
  }

  next();
});

// Index for better performance
CourseSchema.index({
  "category._id": 1,
  isPublished: 1,
});
CourseSchema.index({ title: "text", description: "text" });
CourseSchema.index({ level: 1, "category._id": 1 });
CourseSchema.index({ "author._id": 1 });

const Course = models?.Course || model("Course", CourseSchema);
module.exports = Course;
