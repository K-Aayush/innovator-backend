const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const ReportSchema = new Schema({
  reporter: {
    _id: gen.required(String),
    email: gen.required(String),
    name: gen.required(String),
  },
  reportedUser: {
    _id: gen.required(String),
    email: gen.required(String),
    name: gen.required(String),
  },
  reason: gen.required(String),
  description: gen.required(String),
  status: {
    type: String,
    enum: ["pending", "investigating", "resolved", "dismissed"],
    default: "pending",
  },
  adminResponse: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Report = models?.Report || model("Report", ReportSchema);
module.exports = Report;
