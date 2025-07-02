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
    startTime: String, // Format: "HH:MM"
    endTime: String, // Format: "HH:MM"
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "completed", "cancelled"],
      default: "upcoming",
    },
    maxAttendees: Number,
    currentAttendees: { type: Number, default: 0 },
    availableSeats: { type: Number, default: 0 },
    registrationRequired: { type: Boolean, default: true },
    registrationDeadline: Date,
    registrationStartDate: Date, // When registration opens
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
    speakers: [
      {
        name: String,
        title: String,
        bio: String,
        image: String,
        socialLinks: {
          linkedin: String,
          twitter: String,
          website: String,
        },
      },
    ],
    sponsors: [
      {
        name: String,
        logo: String,
        website: String,
        tier: {
          type: String,
          enum: ["platinum", "gold", "silver", "bronze"],
        },
      },
    ],
    isPublic: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    allowWaitlist: { type: Boolean, default: true },
    certificateTemplate: String, 
    feedbackForm: {
      enabled: { type: Boolean, default: true },
      questions: [
        {
          question: String,
          type: {
            type: String,
            enum: ["text", "rating", "multiple_choice", "checkbox"],
          },
          options: [String], 
          required: { type: Boolean, default: false },
        },
      ],
    },
    socialMedia: {
      hashtag: String,
      facebookEvent: String,
      linkedinEvent: String,
    },
    metadata: {
      totalRegistrations: { type: Number, default: 0 },
      totalAttendees: { type: Number, default: 0 },
      averageRating: { type: Number, default: 0 },
      totalFeedback: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for event duration in hours
EventSchema.virtual("durationHours").get(function () {
  if (this.startDate && this.endDate) {
    return Math.ceil((this.endDate - this.startDate) / (1000 * 60 * 60));
  }
  return 0;
});

// Virtual for registration status
EventSchema.virtual("registrationOpen").get(function () {
  const now = new Date();
  const registrationStart = this.registrationStartDate || this.createdAt;
  const deadline = this.registrationDeadline || this.startDate;

  return (
    now >= registrationStart &&
    now < deadline &&
    this.status === "upcoming" &&
    this.registrationRequired
  );
});

// Virtual for available seats calculation
EventSchema.virtual("seatsAvailable").get(function () {
  if (!this.maxAttendees) return null;
  return Math.max(0, this.maxAttendees - this.currentAttendees);
});

// Virtual for event full status
EventSchema.virtual("isFull").get(function () {
  if (!this.maxAttendees) return false;
  return this.currentAttendees >= this.maxAttendees;
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

  // Update available seats
  if (this.maxAttendees) {
    this.availableSeats = Math.max(
      0,
      this.maxAttendees - this.currentAttendees
    );
  }

  // Set price.isFree based on amount
  if (this.price) {
    this.price.isFree = !this.price.amount || this.price.amount === 0;
  }

  next();
});

// Index for better query performance
EventSchema.index({ startDate: 1, status: 1 });
EventSchema.index({ category: 1, isPublic: 1 });
EventSchema.index({ "eventMaker._id": 1 });
EventSchema.index({ featured: 1, startDate: 1 });
EventSchema.index({ "location.city": 1, startDate: 1 });
EventSchema.index({ tags: 1 });

const Event = models?.Event || model("Event", EventSchema);
module.exports = Event;
