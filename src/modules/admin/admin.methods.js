const User = require("../user/user.model");
const transporter = require("../../config/Mailer");
const GenRes = require("../../utils/routers/GenRes");

// method to add vendor
const AddVendor = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add vendors"
          )
        );
    }

    const {
      email,
      password,
      businessName,
      businessDescription,
      name,
      phone,
      dob,
    } = req.body;

    // Check if vendor already exists
    const existingVendor = await User.findOne({ email: email.toLowerCase() });
    if (existingVendor) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Vendor already exists" },
            "Vendor already exists"
          )
        );
    }

    // Create new user, pass raw password here
    const newVendor = new User({
      email: email.toLowerCase(),
      password,
      businessName,
      businessDescription,
      name,
      phone,
      dob: dob ? new Date(dob) : undefined,
      level: "bronze",
      role: "vendor",
    });

    // Save new vendor (pre-save hook will hash the password)
    await newVendor.save();

    // Send credentials to email
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: email,
      subject: "Your Vendor Account Credentials",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2>Welcome to Our Platform!</h2>
          <p>Your vendor account has been created successfully. Here are your login credentials:</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Password:</strong> ${password}</p>
          </div>
          <p>Please login and change your password immediately for security purposes.</p>
          <p>Best regards,<br>The Admin Team</p>
        </div>
      `,
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { message: "Vendor created successfully" },
          null,
          "Vendor account created"
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

module.exports = { AddVendor };
