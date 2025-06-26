const bcrypt = require("bcryptjs");
const GenRes = require("../../utils/routers/GenRes");
const User = require("./user.model");
const FCMHandler = require("../../utils/notification/fcmHandler");

const ChangePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const userEmail = req.user.email;

    // Validate input
    if (!oldPassword || !newPassword || !confirmPassword) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "All fields are required" },
            "Please provide old password, new password, and confirm password"
          )
        );
    }

    // Check if new password and confirm password match
    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Passwords do not match" },
            "New password and confirm password must match"
          )
        );
    }

    // Validate new password strength
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Password too weak" },
            "Password must be at least 6 characters long"
          )
        );
    }

    // Check if new password is different from old password
    if (oldPassword === newPassword) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Same password" },
            "New password must be different from current password"
          )
        );
    }

    // Find user
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "User not found" }, "User not found"));
    }

    // Check if user has a password (for users who signed up with social login)
    if (!user.password) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "No password set" },
            "Please set a password first using forgot password"
          )
        );
    }

    // Verify old password
    const isOldPasswordCorrect = await bcrypt.compare(
      oldPassword,
      user.password
    );
    if (!isOldPasswordCorrect) {
      return res
        .status(401)
        .json(
          GenRes(
            401,
            null,
            { error: "Incorrect old password" },
            "Current password is incorrect"
          )
        );
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await User.findOneAndUpdate(
      { email: userEmail },
      {
        $set: {
          password: hashedNewPassword,
          // Clear refresh token to force re-login on other devices
          refreshToken: null,
        },
      }
    );

    // Send FCM notification
    try {
      await FCMHandler.sendToUser(user._id, {
        title: "Password Changed",
        body: "Your password has been successfully changed",
        type: "password_change",
        data: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (fcmError) {
      console.error("Failed to send FCM notification:", fcmError);
    }

    // Log the password change for security
    console.log(`Password changed for user: ${userEmail} at ${new Date()}`);

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { message: "Password changed successfully" },
          null,
          "Password changed successfully. Please login again on other devices."
        )
      );
  } catch (error) {
    console.error("Error changing password:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = ChangePassword;
