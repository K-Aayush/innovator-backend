const { tokenGen } = require("../../utils/auth/tokenHandler");
const GenRes = require("../../utils/routers/GenRes");
const User = require("./user.model");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const loginUser = async (req, res) => {
  try {
    const email = req?.body?.email?.toLowerCase() || req?.user?.email;
    const password = req?.body?.password;
    const isFirebaseAuth = !!req.user;

    // Validate input for local authentication
    if (!isFirebaseAuth && (!email || !password)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Email and Password required for local login" },
            "Email/Password required"
          )
        );
    }

    // Find user by email
    let userData = await User.findOne({ email });

    // Handle Firebase authentication: create new user if not found
    if (!userData && isFirebaseAuth) {
      const newData = {
        email: req.user.email,
        name: req.user.name || req.user.email.split("@")[0],
        picture: req.user.picture || "",
        uid: req.user.uid,
        dob: new Date("2000-01-01"),
        phone: "Not provided",
        level: "bronze",
        role: "user",
        isVerified: false,
        signedIn: [new Date()],
        fcmTokens: process.env.DEFAULT_FCM_TOKEN
          ? [process.env.DEFAULT_FCM_TOKEN]
          : [],
      };
      userData = new User(newData);
      await userData.save();

      // Create user directory
      try {
        const joinedPath = path.join(process.cwd(), "Uploads", email);
        fs.mkdirSync(joinedPath, { recursive: true });
      } catch (err) {
        console.error("Error creating user directory:", err);
      }
    }

    // If user still not found (local auth case)
    if (!userData) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "User not registered!" }, "User not found")
        );
    }

    // Check ban status
    if (userData.banned && userData.banEndDate > new Date()) {
      return res.status(403).json(
        GenRes(
          403,
          null,
          {
            error: "Account suspended",
            banEndDate: userData.banEndDate,
            reason: userData.banReason,
          },
          `Account suspended until ${userData.banEndDate.toLocaleDateString()}`
        )
      );
    } else if (userData.banned) {
      // Clear ban if expired
      userData.banned = false;
      userData.banEndDate = null;
      userData.banReason = null;
      await userData.save();
    }

    // Validate password for local authentication
    if (!isFirebaseAuth) {
      if (!userData.password) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "No password set for local authentication" },
              "Password required"
            )
          );
      }
      const isCorrectPassword = await bcrypt.compare(
        password,
        userData.password
      );
      if (!isCorrectPassword) {
        return res
          .status(401)
          .json(
            GenRes(
              401,
              null,
              { error: "Incorrect password" },
              "Incorrect credentials"
            )
          );
      }
    }

    // Update FCM token from environment variable if available
    if (process.env.DEFAULT_FCM_TOKEN) {
      if (!userData.fcmTokens) {
        userData.fcmTokens = [];
      }
      if (!userData.fcmTokens.includes(process.env.DEFAULT_FCM_TOKEN)) {
        userData.fcmTokens.push(process.env.DEFAULT_FCM_TOKEN);
      }
    }

    // Update signedIn dates
    userData.signedIn = [...(userData?.signedIn || []), new Date()];

    // Generate tokens
    const genData = {
      email: userData.email,
      _id: userData._id.toString(),
      phone: userData.phone,
      date: new Date(),
    };
    const { refreshToken, accessToken } = tokenGen(genData);
    userData.refreshToken = refreshToken;
    await userData.save();

    // Prepare response data
    const obj = userData.toObject();
    delete obj.password;
    delete obj.refreshToken;
    delete obj.signedIn;

    return res.status(200).json({
      ...GenRes(200, obj, null, "Logged in successfully"),
      accessToken,
      refreshToken,
    });
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = loginUser;
