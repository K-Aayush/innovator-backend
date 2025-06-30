const jwt = require("jsonwebtoken");
const { tokenGen } = require("../utils/auth/tokenHandler");
const User = require("../modules/user/user.model");
const { firebaseMiddleware } = require("./firebaseMiddleware");
const GenRes = require("../utils/routers/GenRes");

const secretKey = process.env.JWT_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;

const basicMiddleware = async (req, res, next) => {
  req.user = null;
  req.admin = null;

  try {
    const authHeader = req.headers?.authorization;
    // No token at all
    if (!authHeader) {
      throw new Error("Authorization header missing.");
    }

    // Handle non-bearer token (assume Firebase auth fallback)
    if (!authHeader.startsWith("Bearer ")) {
      return await firebaseMiddleware(req, res, next);
    }

    const jwtToken = authHeader.replace("Bearer ", "").trim();
    if (!jwtToken) throw new Error("Empty Bearer token received.");

    let decoded;
    try {
      // Validate the access token
      decoded = jwt.verify(jwtToken, secretKey);
    } catch (err) {
      // Access token might be expired, try to decode it
      const fallbackDecoded = jwt.decode(jwtToken);

      if (!fallbackDecoded || !fallbackDecoded.refreshToken) {
        throw new Error("Access token invalid and no refresh token present.");
      }

      // Validate the refresh token
      try {
        jwt.verify(fallbackDecoded.refreshToken, refreshSecret);
      } catch (refreshErr) {
        throw new Error("Invalid or expired refresh token.");
      }

      const { _id, email, phone } = fallbackDecoded;

      // Generate new tokens
      const newTokens = tokenGen({ _id, email, phone });

      // Attempt to update the user's refresh token
      const user = await User.findOneAndUpdate(
        { _id, email, refreshToken: fallbackDecoded.refreshToken },
        { $set: { refreshToken: newTokens.refreshToken } },
        { new: true }
      );

      if (!user) {
        throw new Error("User not found or refresh token mismatch.");
      }

      const response = GenRes(
        426,
        { accessToken: newTokens.accessToken },
        null,
        "New access token issued. Please retry with the new token."
      );
      return res.status(426).json(response);
    }

    // Verified access token — fetch actual user from DB
    const user = await User.findById(decoded._id).lean();
    if (!user) {
      throw new Error("Authenticated user not found in the database.");
    }

    // Attach essential user info to request
    req.user = {
      _id: user._id,
      email: user.email,
      phone: user.phone || null,
      role: user.role,
      uid: user.uid || null,
    };

    if (user.role === "admin") {
      req.admin = {
        _id: user._id,
        email: user.email,
        phone: user.phone || null,
      };
    }

    return next();
  } catch (error) {
    const response = GenRes(401, null, error, error?.message || "Unauthorized");
    return res.status(401).json(response);
  }
};

module.exports = basicMiddleware;
