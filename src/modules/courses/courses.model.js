const { Schema, models, model } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const CourseSchema = new Schema(
  {
    title: gen.required(String),
    description: gen.required(String),
    price: gen.required({
      usd: gen.required(Number),
      npr: gen.required(Number),
    }),
    thumbnail: gen.required(String),
    notes: gen.required([
      {
        name: gen.required(String),
        pdf: gen.required(String),
        premium: gen.required(Boolean, { default: false }),
        fileType: {
          type: String,
          enum: ["pdf", "video", "other"],
          default: "pdf",
        },
        duration: String,
        fileSize: String,
        description: String,
        sortOrder: {
          type: Number,
          default: 0,
        },
      },
    ]),
    category: {
      _id: gen.required(String),
      name: gen.required(String),
      slug: String,
    },
    author: gen.required({
      email: gen.required(String),
      _id: gen.required(String),
      phone: gen.required(String),
    }),
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
    tags: [String],
    prerequisites: [String],
    learningOutcomes: [String],
    isPublished: {
      type: Boolean,
      default: true,
    },
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
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for total content count
CourseSchema.virtual("totalContent").get(function () {
  return this.notes ? this.notes.length : 0;
});

// Virtual for PDF count
CourseSchema.virtual("pdfCount").get(function () {
  return this.notes
    ? this.notes.filter(
        (note) => note.pdf && note.pdf.toLowerCase().endsWith(".pdf")
      ).length
    : 0;
});

// Virtual for video count
CourseSchema.virtual("videoCount").get(function () {
  const videoExtensions = [
    ".mp4",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".mkv",
  ];
  return this.notes
    ? this.notes.filter((note) => {
        if (!note.pdf) return false;
        const ext = require("path").extname(note.pdf).toLowerCase();
        return videoExtensions.includes(ext);
      }).length
    : 0;
});

// Pre-save middleware to set file types
CourseSchema.pre("save", function (next) {
  if (this.notes && this.notes.length > 0) {
    this.notes.forEach((note) => {
      if (note.pdf) {
        const ext = require("path").extname(note.pdf).toLowerCase();
        const videoExtensions = [
          ".mp4",
          ".avi",
          ".mov",
          ".wmv",
          ".flv",
          ".webm",
          ".mkv",
        ];

        if (note.pdf.toLowerCase().endsWith(".pdf")) {
          note.fileType = "pdf";
        } else if (videoExtensions.includes(ext)) {
          note.fileType = "video";
        } else {
          note.fileType = "other";
        }
      }
    });
  }
  next();
});

// Index for better performance
CourseSchema.index({ "category._id": 1, isPublished: 1 });
CourseSchema.index({ title: "text", description: "text" });
CourseSchema.index({ level: 1, "category._id": 1 });

const Courses = models?.Course || model("Course", CourseSchema);
module.exports = Courses;
