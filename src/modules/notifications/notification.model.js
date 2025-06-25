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
        "share",
        "follow",
      ],
    }),
    content: gen.required(String),
    read: gen.required(Boolean, { default: false }),
    readAt: Date,
    metadata: {
      itemId: String, 
      itemType: String, 
      additionalInfo: Schema.Types.Mixed,
    
      redirectUrl: String,
      redirectType: String, 
      originalContentId: String, 
      commentId: String, 
      messageId: String, 
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    // Facebook-like action data
    actionData: {
      action: String, // 'like', 'comment', 'share', 'follow'
      targetType: String, // 'post', 'comment', 'profile'
      targetId: String, // ID of the target
      contextText: String, // Additional context
    },
  },
  {
    timestamps: true,
    index: [
      { "recipient._id": 1, createdAt: -1 },
      { "recipient._id": 1, read: 1 },
      { "metadata.itemId": 1, "metadata.itemType": 1 },
    ],
  }
);

const Notification =
  models?.Notification || model("Notification", NotificationSchema);
module.exports = Notification;
