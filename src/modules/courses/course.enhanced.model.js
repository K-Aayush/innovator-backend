const { Schema, models, model } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

// Lesson Schema for course structure
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
  metadata: {
    estimatedTime: Number,
    difficulty: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    prerequisites: [String],
  },
});

// Note Schema with lesson association
const NoteSchema = new Schema({
  title: gen.required(String),
  description: String,
  fileUrl: gen.required(String),
  fileType: {
    type: String,
    enum: ["pdf", "document", "text"],
    default: "pdf",
  },
  lessonId: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  premium: {
    type: Boolean,
    default: false,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  metadata: {
    fileSize: String,
    pageCount: Number,
    downloadCount: {
      type: Number,
      default: 0,
    },
  },
});

// Video Schema with lesson association
const VideoSchema = new Schema({
  title: gen.required(String),
  description: String,
  videoUrl: gen.required(String),
  thumbnail: String,
  duration: String,
  lessonId: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  premium: {
    type: Boolean,
    default: false,
  },
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
  },
});

const EnhancedCourseSchema = new Schema(
  {
    title: gen.required(String),
    description: gen.required(String),
    overview: String,
    overviewVideo: String, // Course overview video

    // Pricing
    price: gen.required({
      usd: gen.required(Number),
      npr: gen.required(Number),
    }),

    // Media
    thumbnail: gen.required(String), // Course thumbnail image

    // Course structure
    lessons: [LessonSchema],
    notes: [NoteSchema],
    videos: [VideoSchema],

    // Category hierarchy - only parent and subcategory
    parentCategory: {
      _id: gen.required(String),
      name: gen.required(String),
      slug: String,
    },
    subcategory: {
      _id: gen.required(String),
      name: gen.required(String),
      slug: String,
    },

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
    lastUpdated: {
      type: Date,
      default: Date.now,
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
      discussionEnabled: {
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
EnhancedCourseSchema.virtual("totalContent").get(function () {
  return (this.notes?.length || 0) + (this.videos?.length || 0);
});

// Virtual for lesson count
EnhancedCourseSchema.virtual("lessonCount").get(function () {
  return this.lessons?.length || 0;
});

// Virtual for notes by lesson
EnhancedCourseSchema.virtual("notesByLesson").get(function () {
  const notesByLesson = {};

  // General notes (not associated with any lesson)
  notesByLesson.general = this.notes?.filter((note) => !note.lessonId) || [];

  // Notes by lesson
  this.lessons?.forEach((lesson) => {
    notesByLesson[lesson._id.toString()] =
      this.notes?.filter(
        (note) =>
          note.lessonId && note.lessonId.toString() === lesson._id.toString()
      ) || [];
  });

  return notesByLesson;
});

// Virtual for videos by lesson
EnhancedCourseSchema.virtual("videosByLesson").get(function () {
  const videosByLesson = {};

  // General videos (not associated with any lesson)
  videosByLesson.general =
    this.videos?.filter((video) => !video.lessonId) || [];

  // Videos by lesson
  this.lessons?.forEach((lesson) => {
    videosByLesson[lesson._id.toString()] =
      this.videos?.filter(
        (video) =>
          video.lessonId && video.lessonId.toString() === lesson._id.toString()
      ) || [];
  });

  return videosByLesson;
});

// Pre-save middleware
EnhancedCourseSchema.pre("save", function (next) {
  // Sort lessons, notes, and videos by sortOrder
  if (this.lessons) {
    this.lessons.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  if (this.notes) {
    this.notes.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  if (this.videos) {
    this.videos.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Update lastUpdated
  this.lastUpdated = new Date();

  next();
});

// Index for better performance
EnhancedCourseSchema.index({
  "parentCategory._id": 1,
  "subcategory._id": 1,
  isPublished: 1,
});
EnhancedCourseSchema.index({ title: "text", description: "text" });
EnhancedCourseSchema.index({ level: 1, "parentCategory._id": 1 });
EnhancedCourseSchema.index({ "author._id": 1 });

const EnhancedCourse =
  models?.EnhancedCourse || model("EnhancedCourse", EnhancedCourseSchema);
module.exports = EnhancedCourse;
