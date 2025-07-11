const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const SubcategoryEnrollmentSchema = new Schema(
  {
    student: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
      phone: gen.required(String),
      city: gen.required(String),
      country: gen.required(String),
      picture: String,
    },
    subcategory: {
      _id: gen.required(String),
      name: gen.required(String),
      slug: String,
      parentCategory: {
        _id: gen.required(String),
        name: gen.required(String),
        slug: String,
      },
    },
    enrollmentDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "cancelled", "completed", "suspended"],
      default: "active",
    },
    progress: {
      completedCourses: [
        {
          courseId: { type: String, required: true },
          completedAt: { type: Date, default: Date.now },
          completionPercentage: { type: Number, default: 0 },
          timeSpent: { type: Number, default: 0 },
        },
      ],
      totalCoursesCompleted: { type: Number, default: 0 },
      overallProgress: { type: Number, default: 0 },
      lastAccessedCourse: {
        courseId: String,
        accessedAt: Date,
      },
      totalTimeSpent: { type: Number, default: 0 },
      streakDays: { type: Number, default: 0 },
      lastActivityDate: { type: Date, default: Date.now },
    },
    accessSettings: {
      canAccessVideos: { type: Boolean, default: true },
      canAccessNotes: { type: Boolean, default: true },
      canDownloadContent: { type: Boolean, default: false },
      maxDevices: { type: Number, default: 3 },
    },
    certificate: {
      issued: { type: Boolean, default: false },
      issuedDate: Date,
      certificateId: String,
      downloadUrl: String,
    },
    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      review: String,
      suggestions: String,
      reviewDate: Date,
    },
    personalNotes: [
      {
        content: String,
        courseId: String,
        lessonId: String,
        createdAt: { type: Date, default: Date.now },
        noteType: {
          type: String,
          enum: ["personal", "bookmark", "question"],
          default: "personal",
        },
      },
    ],
    cancellationInfo: {
      cancelledAt: Date,
      reason: String,
      feedback: String,
    },
  },
  {
    timestamps: true,
    indexes: [
      { "student._id": 1, "subcategory._id": 1 },
      { "subcategory._id": 1 },
      { "student._id": 1 },
      { status: 1 },
      { enrollmentDate: -1 },
    ],
  }
);

// Compound unique index to prevent duplicate enrollments
SubcategoryEnrollmentSchema.index(
  { "student._id": 1, "subcategory._id": 1 },
  { unique: true }
);

// Virtual for enrollment completion status
SubcategoryEnrollmentSchema.virtual("isCompleted").get(function () {
  return this.progress.overallProgress >= 100;
});

// Virtual for days since enrollment
SubcategoryEnrollmentSchema.virtual("daysSinceEnrollment").get(function () {
  return Math.floor(
    (Date.now() - this.enrollmentDate.getTime()) / (1000 * 60 * 60 * 24)
  );
});

// Pre-save middleware to update progress
SubcategoryEnrollmentSchema.pre("save", function (next) {
  // Update overall progress based on completed courses
  if (this.progress.completedCourses.length > 0) {
    const totalProgress = this.progress.completedCourses.reduce(
      (sum, course) => sum + course.completionPercentage,
      0
    );
    this.progress.overallProgress = Math.round(
      totalProgress / this.progress.completedCourses.length
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

const SubcategoryEnrollment =
  models?.SubcategoryEnrollment ||
  model("SubcategoryEnrollment", SubcategoryEnrollmentSchema);

module.exports = SubcategoryEnrollment;
