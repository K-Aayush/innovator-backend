const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const EventRegistrationSchema = new Schema(
  {
    event: {
      _id: gen.required(String),
      title: gen.required(String),
      startDate: gen.required(Date),
      endDate: gen.required(Date),
      location: {
        venue: String,
        address: String,
        city: String,
        country: String,
      },
    },
    registrant: {
      name: gen.required(String),
      email: gen.required(String),
      phone: gen.required(String),
      type: gen.required(String, {
        enum: ["student", "business", "professional", "other"],
      }),
      organization: String, // Company/University name
      designation: String, // Job title/Student year
      location: {
        address: String,
        city: gen.required(String),
        state: String,
        country: gen.required(String),
        zipCode: String,
      },
      emergencyContact: {
        name: String,
        phone: String,
        relationship: String,
      },
    },
    registrationDetails: {
      registrationDate: {
        type: Date,
        default: Date.now,
      },
      registrationNumber: gen.unique(String),
      status: {
        type: String,
        enum: ["pending", "confirmed", "cancelled", "waitlisted"],
        default: "pending",
      },
      paymentStatus: {
        type: String,
        enum: ["pending", "paid", "refunded", "waived"],
        default: "pending",
      },
      paymentAmount: {
        type: Number,
        default: 0,
      },
      specialRequirements: String,
      dietaryRestrictions: String,
      accessibilityNeeds: String,
    },
    attendance: {
      checkedIn: {
        type: Boolean,
        default: false,
      },
      checkInTime: Date,
      checkInBy: String,
      attended: {
        type: Boolean,
        default: false,
      },
      feedback: {
        rating: {
          type: Number,
          min: 1,
          max: 5,
        },
        comments: String,
        submittedAt: Date,
      },
    },
    metadata: {
      source: {
        type: String,
        enum: ["website", "mobile_app", "admin", "bulk_import"],
        default: "website",
      },
      userAgent: String,
      ipAddress: String,
      referralCode: String,
      marketingConsent: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Generate unique registration number
EventRegistrationSchema.pre("save", function (next) {
  if (!this.registrationDetails.registrationNumber) {
    const eventPrefix = this.event.title
      .substring(0, 3)
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    this.registrationDetails.registrationNumber = `${eventPrefix}${timestamp}${random}`;
  }
  next();
});

// Virtual for full name
EventRegistrationSchema.virtual("fullName").get(function () {
  return this.registrant.name;
});

// Virtual for registration age
EventRegistrationSchema.virtual("registrationAge").get(function () {
  return Math.floor(
    (Date.now() - this.registrationDetails.registrationDate) /
      (1000 * 60 * 60 * 24)
  );
});

// Index for better performance
EventRegistrationSchema.index({ "event._id": 1, "registrant.email": 1 });
EventRegistrationSchema.index({ "registrationDetails.registrationNumber": 1 });
EventRegistrationSchema.index({ "registrationDetails.status": 1 });
EventRegistrationSchema.index({ "registrant.email": 1 });

const EventRegistration =
  models?.EventRegistration ||
  model("EventRegistration", EventRegistrationSchema);
module.exports = EventRegistration;
