const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

// Progress tracking for individual lessons/videos/notes
const ProgressItemSchema = new Schema({
  itemId: gen.required(String),
  itemType: gen.required(String, {
    enum: ["lesson", "video", "note"],
  }),
  completed: {
    type: Boolean,
    default: false,
  },
  completedAt: Date,
  timeSpent: {
    type: Number,
    default: 0,
  },
  lastAccessedAt: {
    type: Date,
    default: Date.now,
  },
});

// Course enrollment schema
const EnrollmentSchema = new Schema(
  {
    student: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
      picture: String,
      phone: gen.required(String),
      location: gen.required(String),
    },
    course: {
      _id: gen.required(String),
      title: gen.required(String),
      thumbnail: String,
      price: {
        usd: Number,
        npr: Number,
      },
      isFree: {
        type: Boolean,
        default: true,
      },
    },
    enrollmentDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "completed", "suspended", "cancelled"],
      default: "active",
    },

    // Progress tracking
    progress: {
      completionPercentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      totalTimeSpent: {
        type: Number,
        default: 0,
      },
      lastAccessedAt: {
        type: Date,
        default: Date.now,
      },
      itemsProgress: [ProgressItemSchema],
      completedLessons: {
        type: Number,
        default: 0,
      },
      totalLessons: {
        type: Number,
        default: 0,
      },
      completedVideos: {
        type: Number,
        default: 0,
      },
      totalVideos: {
        type: Number,
        default: 0,
      },
      completedNotes: {
        type: Number,
        default: 0,
      },
      totalNotes: {
        type: Number,
        default: 0,
      },
    },

    // Payment information
    paymentInfo: {
      amount: {
        type: Number,
        default: 0,
      },
      currency: {
        type: String,
        default: "USD",
      },
      paymentMethod: String,
      transactionId: String,
      paymentDate: Date,
      paymentStatus: {
        type: String,
        enum: ["pending", "completed", "failed", "refunded"],
        default: "completed",
      },
    },

    // Completion and certification
    completion: {
      isCompleted: {
        type: Boolean,
        default: false,
      },
      completedAt: Date,
      certificateIssued: {
        type: Boolean,
        default: false,
      },
      certificateId: String,
      certificateUrl: String,
      finalScore: Number,
    },

    // Feedback and rating
    feedback: {
      rating: {
        type: Number,
        min: 1,
        max: 5,
      },
      review: String,
      feedbackDate: Date,
    },

    // Access control
    accessSettings: {
      expiryDate: Date, // for time-limited courses
      downloadAllowed: {
        type: Boolean,
        default: false,
      },
      offlineAccess: {
        type: Boolean,
        default: false,
      },
    },

    // Metadata
    metadata: {
      enrollmentSource: {
        type: String,
        enum: ["website", "mobile_app", "admin", "bulk_import"],
        default: "website",
      },
      deviceInfo: String,
      ipAddress: String,
      referralCode: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for overall progress percentage
EnrollmentSchema.virtual("overallProgress").get(function () {
  const totalItems =
    this.progress.totalLessons +
    this.progress.totalVideos +
    this.progress.totalNotes;
  const completedItems =
    this.progress.completedLessons +
    this.progress.completedVideos +
    this.progress.completedNotes;

  if (totalItems === 0) return 0;
  return Math.round((completedItems / totalItems) * 100);
});

// Virtual for time spent in hours
EnrollmentSchema.virtual("timeSpentHours").get(function () {
  return Math.round((this.progress.totalTimeSpent / 3600) * 100) / 100;
});

// Pre-save middleware to update completion status
EnrollmentSchema.pre("save", function (next) {
  // Update completion percentage
  this.progress.completionPercentage = this.overallProgress;

  // Check if course is completed
  if (
    this.progress.completionPercentage >= 100 &&
    !this.completion.isCompleted
  ) {
    this.completion.isCompleted = true;
    this.completion.completedAt = new Date();
    this.status = "completed";
  }

  next();
});

// Index for better performance
EnrollmentSchema.index({ "student._id": 1, "course._id": 1 }, { unique: true });
EnrollmentSchema.index({ "course._id": 1, status: 1 });
EnrollmentSchema.index({ "student._id": 1, status: 1 });
EnrollmentSchema.index({ enrollmentDate: 1 });
EnrollmentSchema.index({
  "completion.isCompleted": 1,
  "completion.completedAt": 1,
});

const Enrollment = models?.Enrollment || model("Enrollment", EnrollmentSchema);
module.exports = Enrollment;
