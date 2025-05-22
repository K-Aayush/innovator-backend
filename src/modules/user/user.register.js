const User = require("./user.model");
const path = require("path");
const fs = require("fs");
const GenRes = require("../../utils/routers/GenRes");

const RegisterUser = async (req, res) => {
  try {
    const email = req?.body?.email?.toLowerCase() || req?.user?.email;
    const userExist = await User.findOne({ email });

    if (userExist) {
      if (req?.user?.uid && !userExist.uid) {
        userExist.uid = req.user.uid;
        userExist.picture = req.user.picture || userExist.picture;
        userExist.name = req.user.name || userExist.name;
        await userExist.save();

        const response = GenRes(
          200,
          userExist,
          null,
          "User updated with Google data"
        );
        return res.status(200).json(response);
      }

      const err = GenRes(
        409,
        null,
        { message: "Duplicate Error. CODE = 11000" },
        "This email exists"
      );
      return res.status(err?.status).json(err);
    }

    const newData = {
      ...(req?.user || req?.body),
      level: "bronze",
      role: "user",
      dob: req?.user?.dob || new Date("2000-01-01"),
      phone: req?.user?.phone || "Not provided",
      picture: req?.user?.picture || "",
    };

    const newUser = new User(newData);
    await newUser.save();

    try {
      const joinedPath = path.join(process.cwd(), "uploads", email);
      fs.mkdirSync(joinedPath, { recursive: true });
    } catch (err) {
      console.error("Error creating user directory:", err);
    }

    const response = GenRes(
      200,
      { message: "Data saved!" },
      null,
      "User Created"
    );

    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = RegisterUser;
