const { firebaseAdmin } = require("../config/firebaseAdmin");
const GenRes = require("../utils/routers/GenRes");
const { tokenGen } = require("../utils/auth/tokenHandler");
const User = require("../modules/user/user.model");

const firebaseMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization || req.body.firebaseToken;

    if (!token) {
      return res.status(401).json(GenRes(401, null, null, "Token not found!"));
    }

    const cleanToken = token.startsWith("Bearer ")
      ? token.split("Bearer ")[1]
      : token;
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(cleanToken);

    if (!decodedToken || !decodedToken.email) {
      return res
        .status(401)
        .json(GenRes(401, null, null, "Invalid Firebase token"));
    }

    const user = await User.findOne({ email: decodedToken.email });

    if (!user) {
      req.user = {
        email: decodedToken.email,
        name: decodedToken.name || decodedToken.email.split("@")[0],
        picture: decodedToken.picture || "",
        uid: decodedToken.uid,
        dob: new Date("2000-01-01"),
        phone: "Not provided",
        role: "user",
      };
      return next();
    }

    const tokenData = {
      _id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      date: new Date(),
    };

    const { accessToken, refreshToken } = tokenGen(tokenData);
    user.refreshToken = refreshToken;
    await user.save();

    res.set("X-Access-Token", accessToken);
    res.set("X-Refresh-Token", refreshToken);

    req.user = {
      ...decodedToken,
      _id: user._id,
      role: user.role,
    };

    return next();
  } catch (error) {
    console.error("Firebase Middleware Error:", error);
    return res
      .status(401)
      .json(GenRes(401, null, error, error.message || "Unauthorized"));
  }
};

const optionalFirebaseMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization || req.body.firebaseToken;

    if (!token) {
      req.user = null;
      return next();
    }

    const cleanToken = token.startsWith("Bearer ")
      ? token.split("Bearer ")[1]
      : token;
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(cleanToken);

    if (!decodedToken || !decodedToken.email) {
      req.user = null;
      return next();
    }

    const user = await User.findOne({ email: decodedToken.email });

    if (!user) {
      req.user = {
        email: decodedToken.email,
        name: decodedToken.name || decodedToken.email.split("@")[0],
        picture: decodedToken.picture || "",
        uid: decodedToken.uid,
        dob: new Date("2000-01-01"),
        phone: "Not provided",
        role: "user",
      };
      return next();
    }

    const tokenData = {
      _id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      date: new Date(),
    };

    const { accessToken, refreshToken } = tokenGen(tokenData);
    user.refreshToken = refreshToken;
    await user.save();

    res.set("X-Access-Token", accessToken);
    res.set("X-Refresh-Token", refreshToken);

    req.user = {
      ...decodedToken,
      _id: user._id,
      role: user.role,
    };

    return next();
  } catch (error) {
    console.error("Optional Firebase Middleware Error:", error);
    req.user = null;
    return next();
  }
};

const registerMiddleware = async (req, _, next) => {
  req.user = null;
  try {
    const token = req.headers.authorization || req.body.firebaseToken;
    if (!token) {
      return next();
    }

    const cleanToken = token.startsWith("Bearer ")
      ? token.split("Bearer ")[1]
      : token;
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(cleanToken);

    if (!decodedToken) {
      return next();
    }

    req.user = {
      ...decodedToken,
      role: "user",
    };
    return next();
  } catch (error) {
    req.user = null;
    return next();
  }
};

module.exports = {
  firebaseMiddleware,
  registerMiddleware,
  optionalFirebaseMiddleware,
};
