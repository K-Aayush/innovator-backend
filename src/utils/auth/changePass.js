const redis = require("../../config/connectRedis");
const GenRes = require("../routers/GenRes");
const transporter = require("../../config/Mailer");

const setCode = async (email) => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000);
    const key = `otp:${email}`;
    const value = JSON.stringify({ code: otp, count: 0 });

    // Set OTP with expiry
    await redis.setEx(key, 300, value);

    // Send email
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: email,
      subject: "Email Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2 style="color: #4A90E2;">Email Verification</h2>
          <p>Thank you for registering! Please use the following verification code to complete your registration:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
            <h1 style="color: #4A90E2; font-size: 32px; margin: 0;">${otp}</h1>
          </div>
          <p><strong>Important:</strong></p>
          <ul>
            <li>This code will expire in 5 minutes</li>
            <li>Do not share this code with anyone</li>
            <li>If you didn't request this verification, please ignore this email</li>
          </ul>
          <p>Best regards,<br>Your App Team</p>
        </div>
      `,
    });

    return GenRes(200, null, null, "Otp sent!");
  } catch (err) {
    return GenRes(500, null, err, err?.message);
  }
};

// Verify OTP
const verifyCode = async (email, code) => {
  try {
    const key = `otp:${email}`;
    const data = await redis.get(key);

    if (!data) {
      return GenRes(
        404,
        null,
        { error: "Token Not Found." },
        "Token may be expired!"
      );
    }

    const parsed = JSON.parse(data);
    const userCode = parseInt(code, 10);

    if (parsed.code !== userCode) {
      parsed.count += 1;

      if (parsed.count >= 5) {
        await redis.del(key);
        return GenRes(
          403,
          null,
          { error: "Too many incorrect attempts" },
          "OTP blocked"
        );
      } else {
        await redis.setEx(key, 300, JSON.stringify(parsed));
        return GenRes(
          401,
          null,
          { error: "Incorrect code" },
          `Incorrect OTP! Attempts left: ${5 - parsed.count}`
        );
      }
    }

    await redis.del(key);
    return GenRes(200, null, null, "OTP verified successfully");
  } catch (err) {
    return GenRes(500, null, err, err?.message);
  }
};

module.exports = { setCode, verifyCode };
