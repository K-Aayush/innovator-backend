const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");

const gen = new ModelGenerator();

const CertificateSchema = new Schema(
  {
    certificateId: gen.unique(String),
    student: {
      _id: gen.required(String),
      email: gen.required(String),
      name: gen.required(String),
      picture: String,
    },
    course: {
      _id: gen.required(String),
      title: gen.required(String),
      instructor: {
        name: String,
        credentials: [String],
      },
      duration: String,
      level: String,
    },
    enrollment: {
      _id: gen.required(String),
      enrollmentDate: gen.required(Date),
      completionDate: gen.required(Date),
      finalScore: Number,
      timeSpent: Number,
    },
    certificate: {
      templateId: String,
      certificateUrl: String,
      downloadUrl: String,
      issuedAt: {
        type: Date,
        default: Date.now,
      },
      validUntil: Date,
      verificationCode: gen.unique(String),
      digitalSignature: String,
    },
    verification: {
      isVerified: {
        type: Boolean,
        default: true,
      },
      verificationUrl: String,
      qrCode: String,
    },
    metadata: {
      issuer: {
        name: {
          type: String,
          default: "Your Platform Name",
        },
        logo: String,
        signature: String,
      },
      template: {
        design: {
          type: String,
          default: "modern",
        },
        colors: {
          primary: {
            type: String,
            default: "#4A90E2",
          },
          secondary: {
            type: String,
            default: "#2C3E50",
          },
        },
      },
    },
  },
  {
    timestamps: true,
  }
);

// Generate unique certificate ID
CertificateSchema.pre("save", function (next) {
  if (!this.certificateId) {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");
    this.certificateId = `CERT-${timestamp}-${random}`;
  }

  if (!this.certificate.verificationCode) {
    this.certificate.verificationCode = `VER-${Date.now()}-${Math.floor(
      Math.random() * 100000
    )}`;
  }

  if (!this.verification.verificationUrl) {
    this.verification.verificationUrl = `/verify-certificate/${this.certificate.verificationCode}`;
  }

  next();
});

// Index for verification
CertificateSchema.index({ certificateId: 1 });
CertificateSchema.index({ "certificate.verificationCode": 1 });
CertificateSchema.index({ "student._id": 1 });
CertificateSchema.index({ "course._id": 1 });

const Certificate =
  models?.Certificate || model("Certificate", CertificateSchema);
module.exports = Certificate;
