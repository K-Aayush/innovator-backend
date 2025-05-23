const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const SupportSchema = new Schema({
  user: {
    _id: gen.required(String),
    email: gen.required(String),
    name: gen.required(String),
  },
  subject: gen.required(String),
  message: gen.required(String),
  status: {
    type: String,
    enum: ["pending", "answered"],
    default: "pending",
  },
  adminResponse: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Support = models?.Support || model("Support", SupportSchema);
module.exports = Support;
