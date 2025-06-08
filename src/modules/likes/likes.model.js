const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const LikeSchema = new Schema(
  {
    type: gen.required(String, { enum: ["content", "course", "video"] }),
    uid: gen.required(String),
    user: gen.required({
      _id: gen.required(String),
      name: gen.required(String),
      email: gen.required(String),
      picture: gen.required(String),
    }),
  },
  { timeseries: true, timestamps: true }
);

const Like = models?.Like || model("Like", LikeSchema);
module.exports = Like;
