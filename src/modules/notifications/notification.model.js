const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const NotificationSchema = new Schema(
  {
    recipient: {
      _id: gen.required(String),
      email: gen.required(String),
    },
    sender: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
      picture: String,
    },
    type: gen.required(String, {
      enum: [
        "message",
        "content",
        "shop",
        "course",
        "like",
        "comment",
        "video",
        "reel",
      ],
    }),
    content: gen.required(String),
    read: gen.required(Boolean, { default: false }),
    readAt: Date,
    metadata: {
      itemId: String,
      itemType: String,
      additionalInfo: Schema.Types.Mixed,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
  },
  {
    timestamps: true,
    index: [
      { "recipient._id": 1, createdAt: -1 },
      { "recipient._id": 1, read: 1 },
    ],
  }
);

const Notification =
  models?.Notification || model("Notification", NotificationSchema);
module.exports = Notification;
