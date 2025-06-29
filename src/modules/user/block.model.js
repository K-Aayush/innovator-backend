const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const BlockSchema = new Schema(
  {
    blocker: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
      picture: String,
    },
    blocked: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
      picture: String,
    },
    reason: String,
    blockType: {
      type: String,
      enum: ["full", "content", "messages"],
      default: "full",
    },

    mutualFriends: [String],
    previousInteractions: {
      followedEachOther: Boolean,
      hadConversations: Boolean,
      sharedContent: Boolean,
    },
  },
  {
    timestamps: true,
    indexes: [
      { "blocker._id": 1, "blocked._id": 1 },
      { "blocked._id": 1 },
      { "blocker._id": 1 },
    ],
  }
);

// Compound unique index to prevent duplicate blocks
BlockSchema.index({ "blocker._id": 1, "blocked._id": 1 }, { unique: true });

const Block = models?.Block || model("Block", BlockSchema);
module.exports = Block;
