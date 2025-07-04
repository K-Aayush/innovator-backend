const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const EnrollmentSchema = new Schema(
  {
    student: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
      picture: String,
      phone: String,
    },
    course: {
      _id: gen.required(String),
      title: gen.required(String),
      thumbnail: String,
      price: {
        usd: Number,
        npr: Number,
      },
      totalNotes: { type: Number, default: 0 },
      category: {
        _id: String,
        name: String,
      },
      author: {
        _id: String,
        email: String,
      },
    },
    enrollmentDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "completed", "suspended", "refunded", "expired"],
      default: "active",
    },
    progress: {
      completedNotes: [
        {
          noteId: { type: String, required: true },
          completedAt: { type: Date, default: Date.now },
          timeSpent: { type: Number, default: 0 }, // in seconds
          attempts: { type: Number, default: 1 },
        },
      ],
      completionPercentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      lastAccessedNote: {
        noteId: String,
        accessedAt: Date,
      },
      totalTimeSpent: { type: Number, default: 0 },
      streakDays: { type: Number, default: 0 },
      lastActivityDate: { type: Date, default: Date.now },
    },
    paymentInfo: {
      amount: Number,
      currency: { type: String, default: "USD" },
      paymentMethod: String,
      transactionId: String,
      paymentDate: Date,
      paymentStatus: {
        type: String,
        enum: ["pending", "completed", "failed", "refunded"],
        default: "completed",
      },
    },
    certificate: {
      issued: { type: Boolean, default: false },
      issuedDate: Date,
      certificateId: String,
      downloadUrl: String,
    },
    accessSettings: {
      expiryDate: Date,
      maxDevices: { type: Number, default: 3 },
      downloadAllowed: { type: Boolean, default: false },
      offlineAccess: { type: Boolean, default: true },
    },
    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      review: String,
      reviewDate: Date,
    },
    notes: [
      {
        content: String,
        createdAt: { type: Date, default: Date.now },
        noteType: {
          type: String,
          enum: ["personal", "bookmark", "question"],
          default: "personal",
        },
      },
    ],
  },
  {
    timestamps: true,
    indexes: [
      { "student._id": 1, "course._id": 1 },
      { "course._id": 1 },
      { "student._id": 1 },
      { status: 1 },
      { enrollmentDate: -1 },
    ],
  }
);

// Compound unique index to prevent duplicate enrollments
EnrollmentSchema.index({ "student._id": 1, "course._id": 1 }, { unique: true });

// Virtual for course completion status
EnrollmentSchema.virtual("isCompleted").get(function () {
  return this.progress.completionPercentage >= 100;
});

// Virtual for days since enrollment
EnrollmentSchema.virtual("daysSinceEnrollment").get(function () {
  return Math.floor(
    (Date.now() - this.enrollmentDate.getTime()) / (1000 * 60 * 60 * 24)
  );
});

// Virtual for average time per note
EnrollmentSchema.virtual("averageTimePerNote").get(function () {
  const completedCount = this.progress.completedNotes.length;
  return completedCount > 0
    ? Math.round(this.progress.totalTimeSpent / completedCount)
    : 0;
});

// Pre-save middleware to update completion percentage
EnrollmentSchema.pre("save", function (next) {
  if (this.course.totalNotes > 0) {
    this.progress.completionPercentage = Math.round(
      (this.progress.completedNotes.length / this.course.totalNotes) * 100
    );
  }

  // Update streak days
  const today = new Date();
  const lastActivity = new Date(this.progress.lastActivityDate);
  const daysDiff = Math.floor(
    (today.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysDiff === 1) {
    this.progress.streakDays += 1;
  } else if (daysDiff > 1) {
    this.progress.streakDays = 1;
  }

  this.progress.lastActivityDate = today;
  next();
});

const Enrollment = models?.Enrollment || model("Enrollment", EnrollmentSchema);
module.exports = Enrollment;
