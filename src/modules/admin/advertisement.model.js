const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const AdvertisementSchema = new Schema({
  advertiser: {
    _id: gen.required(String),
    email: gen.required(String),
    name: gen.required(String),
  },
  title: gen.required(String),
  description: gen.required(String),
  image: gen.required(String),
  targetUrl: String,
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "active", "completed"],
    default: "pending",
  },
  duration: {
    start: Date,
    end: Date,
  },
  budget: {
    amount: gen.required(Number),
    currency: {
      type: String,
      default: "USD",
    },
  },
  metrics: {
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  targetAudience: {
    locations: [String],
    interests: [String],
    ageRange: {
      min: Number,
      max: Number,
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Advertisement =
  models?.Advertisement || model("Advertisement", AdvertisementSchema);
module.exports = Advertisement;
