const { tokenGen } = require("../../utils/auth/tokenHandler");
const GenRes = require("../../utils/routers/GenRes");
const User = require("./user.model");
const bcrypt = require("bcryptjs");

const loginUser = async (req, res) => {
  try {
    const email = req?.body?.email?.toLowerCase();
    const password = req?.body?.password;

    // 400
    if (!email || !password) {
      const response = GenRes(
        400,
        null,
        { error: "Email and Password is required!" },
        "400 | Email or password not Found"
      );
      return res.status(400).json(response);
    }

    //
    const userData = await User.findOne({ email });
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

    // check password
    const isCorrectPassword = await bcrypt.compare(
      password,
      userData?.password
    );

    //respond after check password
    if (!isCorrectPassword) {
      const response = GenRes(
        401,
        null,
        { error: "Incorrect Credentials [PASSWORD DIDNT MATCH]" },
        "Incorrect Credentials"
      );
      return res.status(401).json(response);
    }

    userData.signedIn = [...userData?.signedIn, new Date()?.toDateString()];

    const genData = {
      email: userData?.email,
      _id: userData?._id?.toString(),
      phone: userData?.phone,
      date: new Date(),
    };

    const { refreshToken, accessToken } = tokenGen(genData);
    userData.refreshToken = refreshToken;
    await userData.save();
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
