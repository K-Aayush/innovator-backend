const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const EventSchema = new Schema(
  {
    title: gen.required(String),
    description: gen.required(String),
    eventMaker: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
    },
    category: gen.required(String, {
      enum: [
        "conference",
        "workshop",
        "seminar",
        "networking",
        "competition",
        "exhibition",
        "webinar",
        "meetup",
        "training",
        "other",
      ],
    }),
    location: {
      venue: gen.required(String),
      address: String,
      city: String,
      country: String,
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
      isOnline: { type: Boolean, default: false },
      onlineLink: String,
    },
    startDate: gen.required(Date),
    endDate: gen.required(Date),
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "completed", "cancelled"],
      default: "upcoming",
    },
    maxAttendees: Number,
    currentAttendees: { type: Number, default: 0 },
    registrationRequired: { type: Boolean, default: true },
    registrationDeadline: Date,
    images: [String],
    tags: [String],
    price: {
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "NPR" },
      isFree: { type: Boolean, default: true },
    },
    contactInfo: {
      email: String,
      phone: String,
      website: String,
    },
    requirements: [String],
    agenda: [
      {
        time: String,
        title: String,
        description: String,
        speaker: String,
      },
    ],
    isPublic: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for event duration
EventSchema.virtual("duration").get(function () {
  if (this.startDate && this.endDate) {
    return Math.ceil((this.endDate - this.startDate) / (1000 * 60 * 60 * 24));
  }
  return 0;
});

// Virtual for registration status
EventSchema.virtual("registrationOpen").get(function () {
  const now = new Date();
  const deadline = this.registrationDeadline || this.startDate;
  return now < deadline && this.status === "upcoming";
});

// Pre-save middleware to auto-update status based on dates
EventSchema.pre("save", function (next) {
  const now = new Date();

  if (this.status !== "cancelled") {
    if (now < this.startDate) {
      this.status = "upcoming";
    } else if (now >= this.startDate && now <= this.endDate) {
      this.status = "ongoing";
    } else if (now > this.endDate) {
      this.status = "completed";
    }
  }

  next();
});

// Index for better query performance
EventSchema.index({ startDate: 1, status: 1 });
EventSchema.index({ category: 1, isPublic: 1 });
EventSchema.index({ "eventMaker._id": 1 });
EventSchema.index({ featured: 1, startDate: 1 });

const Event = models?.Event || model("Event", EventSchema);
module.exports = Event;
