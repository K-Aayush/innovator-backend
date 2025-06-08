const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const CommentSchema = new Schema(
  {
    type: gen.required(String, { enum: ["content", "course", "video"] }),
    uid: gen.required(String),
    user: gen.required({
      _id: gen.required(String),
      name: gen.required(String),
      email: gen.required(String),
      picture: gen.required(String),
    }),
    comment: gen.required(String),
    edited: gen.required(Boolean, { default: false }),
  },
  { timeseries: true, timestamps: true }
);

const Comment = models?.Comment || model("Comment", CommentSchema);
module.exports = Comment;
