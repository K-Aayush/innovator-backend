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
      enum: ["message", "content", "shop", "course", "like", "comment"],
    }),
    content: gen.required(String),
    read: gen.required(Boolean, { default: false }),
    metadata: {
      itemId: String,
      itemType: String,
      additionalInfo: Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

const Notification =
  models?.Notification || model("Notification", NotificationSchema);
module.exports = Notification;
