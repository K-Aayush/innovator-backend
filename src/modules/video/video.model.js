const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const VideoSchema = new Schema(
  {
    title: gen.required(String),
    description: String,
    videoUrl: gen.required(String),
    thumbnail: String,
    duration: gen.required(Number),
    type: gen.required(String, {
      enum: ["video", "reel"],
      default: "video",
    }),
    tags: [String],
    category: String,
    author: {
      name: gen.required(String),
      picture: String,
      email: gen.required(String),
      _id: gen.required(String),
    },
    views: { type: Number, default: 0 },
    viewedBy: [{ type: String }],
    isPublic: { type: Boolean, default: true },
    quality: {
      type: String,
      enum: ["360p", "480p", "720p", "1080p", "4K"],
      default: "720p",
    },
    fileSize: Number,
    aspectRatio: String, // e.g., "16:9", "9:16"
    processingStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
  },
  { timestamps: true, timeseries: true }
);

VideoSchema.pre("save", function (next) {
  if (!this.author?._id) {
    return next(new Error("Author details must include user_id!"));
  }
  next();
});

const Video = models?.Video || model("Video", VideoSchema);
module.exports = Video;
