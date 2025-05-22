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

    // 400: Check for valid input
    if (!req.user && (!email || !password)) {
      const response = GenRes(
        400,
        null,
        { error: "Email and Password or Firebase token is required!" },
        "400 | Email/Password or Firebase token not found"
      );
      return res.status(400).json(response);
    }

    // Find user by email
    let userData = await User.findOne({ email });

    // If user doesn't exist and Firebase token is provided, create a new user
    if (!userData && req.user) {
      const newData = {
        email: req.user.email,
        name: req.user.name || req.user.email.split("@")[0],
        picture: req.user.picture || "",
        uid: req.user.uid,
        dob: req.user.dob || new Date("2000-01-01"),
        phone: req.user.phone || "Not provided",
        level: "bronze",
        role: "user",
      };
      userData = new User(newData);
      await userData.save();

      // Create user directory (consistent with RegisterUser)
      try {
        const joinedPath = path.join(process.cwd(), "Uploads", email);
        fs.mkdirSync(joinedPath, { recursive: true });
      } catch (err) {
        console.error("Error creating user directory:", err);
      }
    }

    // If user still doesn't exist, return error
    if (!userData) {
      const response = GenRes(
        404,
        null,
        { error: "User not registered!" },
        "User not found"
      );
      return res.status(404).json(response);
    }

    // Check if user is banned
    if (userData.banned) {
      if (userData.banEndDate > new Date()) {
        const response = GenRes(
          403,
          null,
          {
            error: "Account suspended",
            banEndDate: userData.banEndDate,
            reason: userData.banReason,
          },
          `Account suspended until ${userData.banEndDate.toLocaleDateString()}`
        );
        return res.status(403).json(response);
      } else {
        // If ban period is over, remove ban
        userData.banned = false;
        userData.banEndDate = null;
        userData.banReason = null;
        await userData.save();
      }
    }

    // Check password for non-Firebase login
    if (!req.user && password) {
      const isCorrectPassword = await bcrypt.compare(
        password,
        userData?.password
      );
      if (!isCorrectPassword) {
        const response = GenRes(
          401,
          null,
          { error: "Incorrect Credentials [PASSWORD DIDNT MATCH]" },
          "Incorrect Credentials"
        );
        return res.status(401).json(response);
      }
    }

    // Update signedIn history
    userData.signedIn = [
      ...(userData?.signedIn || []),
      new Date().toDateString(),
    ];

    // Generate tokens
    const genData = {
      email: userData?.email,
      _id: userData?._id?.toString(),
      phone: userData?.phone,
      date: new Date(),
    };

    const { refreshToken, accessToken } = tokenGen(genData);
    userData.refreshToken = refreshToken;
    await userData.save();

    // Prepare response data
    const obj = userData.toObject();
    delete obj.signedIn;
    delete obj.password;
    delete obj.refreshToken;

    const saveData = GenRes(200, obj, null, "Logged in");
    return res.status(200).json({ ...saveData, accessToken });
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = loginUser;
