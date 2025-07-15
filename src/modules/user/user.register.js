const User = require("./user.model");
const path = require("path");
const fs = require("fs");
const GenRes = require("../../utils/routers/GenRes");
const { setCode } = require("../../utils/auth/changePass");

const RegisterUser = async (req, res) => {
  try {
    const email = req?.body?.email?.toLowerCase();
    const userExist = await User.findOne({ email });

    if (userExist) {
      const err = GenRes(
        409,
        null,
        { message: "Duplicate Error. CODE = 11000" },
        "This email exists"
      );
      return res.status(err?.status).json(err);
    }

    const isGoogleRegistration = req?.body?.uid && !req?.body?.password;

    const newData = {
      ...req?.body,
      email,
      level: "bronze",
      role: "user",
      dob: new Date("2000-01-01"),
      phone: "Not provided",
      isVerified: isGoogleRegistration,
      emailVerified: isGoogleRegistration,
      emailVerificationRequired: !isGoogleRegistration,
    };

    const newUser = new User(newData);
    await newUser.save();

    try {
      const joinedPath = path.join(process.cwd(), "uploads", email);
      fs.mkdirSync(joinedPath, { recursive: true });
    } catch (err) {
      console.error("Error creating user directory:", err);
    }

    if (!isGoogleRegistration) {
      try {
        const otpResult = await setCode(email);
        if (otpResult.status !== 200) {
          console.error("Failed to send verification OTP:", otpResult.error);
          return res.status(201).json(
            GenRes(
              201,
              {
                message: "User created but verification email failed to send",
                requiresVerification: true,
                canResendOTP: true,
              },
              null,
              "User Created - Please verify email"
            )
          );
        }

        return res.status(201).json(
          GenRes(
            201,
            {
              message:
                "User created successfully. Please check your email for verification code.",
              requiresVerification: true,
              canResendOTP: false,
            },
            null,
            "User Created - Email Verification Required"
          )
        );
      } catch (otpError) {
        console.error("Error sending verification OTP:", otpError);
        return res.status(201).json(
          GenRes(
            201,
            {
              message: "User created but verification email failed to send",
              requiresVerification: true,
              canResendOTP: true,
            },
            null,
            "User Created - Please verify email"
          )
        );
      }
    }

    const response = GenRes(
      201,
      {
        message: "Google user registered successfully!",
        requiresVerification: false,
        emailVerified: true,
      },
      null,
      "User Created and Verified"
    );

    return res.status(201).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = RegisterUser;
