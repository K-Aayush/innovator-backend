const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");
const bcrypt = require("bcryptjs");

const gen = new ModelGenerator();

const UserSchema = new Schema(
  {
    // personal details
    name: gen.required(String),
    dob: gen.required(Date),
    phone: gen.required(String),
    location: String,
    picture: String,
    gender: String,
    education: String,
    profession: String,
    achievements: String,
    bio: String,

    // vendor details
    businessName: String,
    businessDescription: String,
    businessAddress: String,

    // authentication
    email: { type: String, required: true, unique: true },
    uid: gen.unique(String, { required: false }),
    password: String,
    refreshToken: String,
    fcmTokens: [String],

    // ban status
    banned: { type: Boolean, default: false },
    banEndDate: Date,
    banReason: String,

    //isverified admin
    isVerified: { type: Boolean, default: false },

    // Email verification
    emailVerified: { type: Boolean, default: false },
    emailVerificationRequired: { type: Boolean, default: true },
    emailVerifiedAt: Date,

    // access
    role: gen.required(String, "user", ["user", "editor", "admin", "vendor"]),
    level: gen.required(String, "bronze", ["bronze"]),

    // activity
    signedIn: [Date],
  },
  { timeseries: true, timestamps: true }
);

// before saving
UserSchema.pre("save", async function (next) {
  try {
    const uid = this.uid;
    const password = this.password;
    if (!uid && !password) {
      throw new Error("Either Google ID or Password is required!");
    }
    if (!password || !this.isModified("password")) {
      return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(password, salt);
    return next();
  } catch (error) {
    return next(error);
  }
});

const User = models?.User || model("User", UserSchema);

module.exports = User;
