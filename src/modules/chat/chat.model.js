const { Schema, model, models } = require("mongoose");
const ModelGenerator = require("../../utils/database/modelGenerator");
const CryptoJS = require("crypto-js");

const gen = new ModelGenerator();

// Subdocument schema for User
const UserSchema = new Schema(
  {
    _id: gen.required(String),
    email: gen.required(String),
    name: gen.required(String),
    picture: String,
  },
  { _id: false }
);

// Message Schema
const MessageSchema = new Schema(
  {
    sender: UserSchema,
    receiver: UserSchema,
    message: gen.required(String),
    read: gen.required(Boolean, { default: false }),
    readAt: Date,
    deletedBySender: gen.required(Boolean, { default: false }),
    deletedByReceiver: gen.required(Boolean, { default: false }),
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Static methods for encryption/decryption
MessageSchema.statics.encryptMessage = function (
  message,
  key = process.env.CHAT_ENCRYPTION_KEY
) {
  try {
    return CryptoJS.AES.encrypt(message, key).toString();
  } catch (error) {
    console.error("Error encrypting message:", error);
    throw new Error("Failed to encrypt message");
  }
};

MessageSchema.statics.decryptMessage = function (
  encryptedMessage,
  key = process.env.CHAT_ENCRYPTION_KEY
) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedMessage, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error("Error decrypting message:", error);
    return "[Encrypted Message]";
  }
};

// Instance methods
MessageSchema.methods.encryptMessage = function (message) {
  return this.constructor.encryptMessage(message);
};

MessageSchema.methods.decryptMessage = function () {
  return this.constructor.decryptMessage(this.message);
};

// Pre-save hook for encryption
MessageSchema.pre("save", function (next) {
  if (this.isModified("message")) {
    try {
      this.message = this.constructor.encryptMessage(this.message);
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Virtual for decrypted message
MessageSchema.virtual("decryptedMessage").get(function () {
  return this.decryptMessage();
});

const ChatMessage = models?.ChatMessage || model("ChatMessage", MessageSchema);
module.exports = ChatMessage;
