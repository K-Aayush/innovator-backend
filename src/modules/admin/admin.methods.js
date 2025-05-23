const User = require("../user/user.model");
const Content = require("../contents/contents.model");
const Shop = require("../shop/shop.model");
const Report = require("../user/report.model");
const Support = require("../user/support.model");
const transporter = require("../../config/Mailer");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const FCMHandler = require("../../utils/notifications/fcmHandler");

// Get all users with pagination and filtering
const GetUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view users"
          )
        );
    }

    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search;
    const role = req.query.role;
    const status = req.query.status;

    const query = {};

    if (search) {
      query.$or = [
        { email: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    if (role) {
      query.role = role;
    }

    if (status === "banned") {
      query.banned = true;
    } else if (status === "active") {
      query.banned = { $ne: true };
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password -refreshToken")
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          users,
          total,
          page,
          pages: Math.ceil(total / limit),
        },
        null,
        "Users retrieved successfully"
      )
    );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Get user details with their content
const GetUserDetails = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view user details"
          )
        );
    }

    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid user ID" },
            "Invalid user ID provided"
          )
        );
    }

    const user = await User.findById(userId)
      .select("-password -refreshToken")
      .lean();
    if (!user) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "User not found" }, "User not found"));
    }

    const [contents, products] = await Promise.all([
      Content.find({ "author._id": userId }).lean(),
      Shop.find({ "vendor._id": userId }).lean(),
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          user,
          contents,
          products,
        },
        null,
        "User details retrieved successfully"
      )
    );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Add vendor
const AddVendor = async (req, res) => {
  try {
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

    await newVendor.save();

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

// Get user statistics
const GetUserStats = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view statistics"
          )
        );
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalUsers, newToday, newThisWeek, newThisMonth] = await Promise.all(
      [
        User.countDocuments({ role: "user" }),
        User.countDocuments({ role: "user", createdAt: { $gte: today } }),
        User.countDocuments({ role: "user", createdAt: { $gte: thisWeek } }),
        User.countDocuments({ role: "user", createdAt: { $gte: thisMonth } }),
      ]
    );

    return res.status(200).json(
      GenRes(
        200,
        {
          total: totalUsers,
          today: newToday,
          thisWeek: newThisWeek,
          thisMonth: newThisMonth,
        },
        null,
        "User statistics retrieved"
      )
    );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Get user leaderboard
const GetLeaderboard = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view leaderboard"
          )
        );
    }

    const pipeline = [
      {
        $group: {
          _id: "$author.email",
          posts: { $sum: 1 },
          author: { $first: "$author" },
        },
      },
      { $sort: { posts: -1 } },
      { $limit: 10 },
    ];

    const leaderboard = await Content.aggregate(pipeline);

    return res
      .status(200)
      .json(
        GenRes(200, leaderboard, null, "Leaderboard retrieved successfully")
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Ban user
const BanUser = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can ban users"
          )
        );
    }

    const { userId, duration, reason } = req.body;

    if (!userId || !duration || !reason) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Missing required fields" },
            "Please provide all required fields"
          )
        );
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "User not found" }, "User not found"));
    }

    const banEndDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

    user.banned = true;
    user.banEndDate = banEndDate;
    user.banReason = reason;
    await user.save();

    await transporter.sendMail({
      from: process.env.EMAIL,
      to: user.email,
      subject: "Account Temporarily Suspended",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2>Account Suspension Notice</h2>
          <p>Dear ${user.name},</p>
          <p>Your account has been temporarily suspended for the following reason:</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p>${reason}</p>
          </div>
          <p>Your account will be suspended until: ${banEndDate.toLocaleDateString()}</p>
          <p>If you believe this is a mistake, please contact our support team.</p>
          <p>Best regards,<br>The Admin Team</p>
        </div>
      `,
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { message: "User banned successfully" },
          null,
          "User banned"
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Get vendor statistics
const GetVendorStats = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view vendor statistics"
          )
        );
    }

    const vendors = await User.find({ role: "vendor" }).select(
      "_id email businessName"
    );
    const vendorStats = await Promise.all(
      vendors.map(async (vendor) => {
        const products = await Shop.find({ "vendor._id": vendor._id });
        return {
          vendor: {
            _id: vendor._id,
            email: vendor.email,
            businessName: vendor.businessName,
          },
          totalProducts: products.length,
          totalValue: products.reduce(
            (sum, product) => sum + product.price * product.stock,
            0
          ),
        };
      })
    );

    return res
      .status(200)
      .json(GenRes(200, vendorStats, null, "Vendor statistics retrieved"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Delete user content
const DeleteUserContent = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete content"
          )
        );
    }

    const { contentId, reason } = req.body;

    if (!contentId || !reason) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Missing required fields" },
            "Please provide all required fields"
          )
        );
    }

    const content = await Content.findById(contentId);
    if (!content) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Content not found" }, "Content not found")
        );
    }

    await Content.findByIdAndDelete(contentId);

    await transporter.sendMail({
      from: process.env.EMAIL,
      to: content.author.email,
      subject: "Content Removed - Policy Violation",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2>Content Removal Notice</h2>
          <p>Dear ${content.author.name},</p>
          <p>Your content has been removed for the following reason:</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p>${reason}</p>
          </div>
          <p>Please review our community guidelines to avoid future violations.</p>
          <p>Best regards,<br>The Admin Team</p>
        </div>
      `,
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { message: "Content deleted successfully" },
          null,
          "Content deleted"
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Handle advertisement requests
const HandleAdRequest = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can handle ad requests"
          )
        );
    }

    const { adId, status, message } = req.body;

    const ad = await Advertisement.findById(adId);
    if (!ad) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Advertisement not found" },
            "Advertisement not found"
          )
        );
    }

    ad.status = status;
    await ad.save();

    // Send notification to advertiser
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: ad.advertiser.email,
      subject: `Advertisement ${
        status.charAt(0).toUpperCase() + status.slice(1)
      }`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2>Advertisement Update</h2>
          <p>Dear ${ad.advertiser.name},</p>
          <p>Your advertisement request has been ${status}.</p>
          ${message ? `<p>Message from admin: ${message}</p>` : ""}
          <p>Advertisement Details:</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Title:</strong> ${ad.title}</p>
            <p><strong>Duration:</strong> ${ad.duration.start.toLocaleDateString()} - ${ad.duration.end.toLocaleDateString()}</p>
            <p><strong>Budget:</strong> ${ad.budget.amount} ${
        ad.budget.currency
      }</p>
          </div>
          <p>Best regards,<br>The Admin Team</p>
        </div>
      `,
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { message: "Advertisement status updated" },
          null,
          "Status updated successfully"
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Get advertisement statistics
const GetAdStats = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view ad statistics"
          )
        );
    }

    const stats = await Advertisement.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalBudget: { $sum: "$budget.amount" },
          totalViews: { $sum: "$metrics.views" },
          totalClicks: { $sum: "$metrics.clicks" },
        },
      },
    ]);

    return res
      .status(200)
      .json(GenRes(200, stats, null, "Advertisement statistics retrieved"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Get all reports
const GetReports = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view reports"
          )
        );
    }

    const page = parseInt(req.query.page) || 0;
    const limit = 20;
    const status = req.query.status;

    const query = status ? { status } : {};

    const [reports, total] = await Promise.all([
      Report.find(query)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .lean(),
      Report.countDocuments(query),
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          reports,
          total,
          page,
          pages: Math.ceil(total / limit),
        },
        null,
        "Reports retrieved successfully"
      )
    );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Handle report response
const HandleReport = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can handle reports"
          )
        );
    }

    const { reportId, status, response } = req.body;

    const report = await Report.findById(reportId);
    if (!report) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Report not found" }, "Report not found")
        );
    }

    report.status = status;
    report.adminResponse = response;
    await report.save();

    // Send email notification
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: report.reporter.email,
      subject: "Update on Your Report",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2>Update on Your Report</h2>
          <p>Your report regarding ${report.reportedUser.name} has been updated.</p>
          <p><strong>Status:</strong> ${status}</p>
          <p><strong>Admin Response:</strong> ${response}</p>
        </div>
      `,
    });

    // Send FCM notification
    await FCMHandler.sendToUser(report.reporter._id, {
      title: "Report Update",
      body: `Your report has been updated to: ${status}`,
      type: "report_update",
      data: {
        reportId: report._id.toString(),
        status,
      },
    });

    return res
      .status(200)
      .json(GenRes(200, report, null, "Report handled successfully"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Get all support tickets
const GetSupportTickets = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view support tickets"
          )
        );
    }

    const page = parseInt(req.query.page) || 0;
    const limit = 20;
    const status = req.query.status;

    const query = status ? { status } : {};

    const [tickets, total] = await Promise.all([
      Support.find(query)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .lean(),
      Support.countDocuments(query),
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          tickets,
          total,
          page,
          pages: Math.ceil(total / limit),
        },
        null,
        "Support tickets retrieved successfully"
      )
    );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Handle support ticket response
const HandleSupportTicket = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can handle support tickets"
          )
        );
    }

    const { ticketId, response } = req.body;

    const ticket = await Support.findById(ticketId);
    if (!ticket) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Ticket not found" },
            "Support ticket not found"
          )
        );
    }

    ticket.status = "answered";
    ticket.adminResponse = response;
    await ticket.save();

    // Send email notification
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: ticket.user.email,
      subject: "Response to Your Support Ticket",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2>Support Ticket Response</h2>
          <p><strong>Subject:</strong> ${ticket.subject}</p>
          <p><strong>Your Message:</strong> ${ticket.message}</p>
          <p><strong>Our Response:</strong> ${response}</p>
        </div>
      `,
    });

    // Send FCM notification
    await FCMHandler.sendToUser(ticket.user._id, {
      title: "Support Ticket Response",
      body: "We've responded to your support ticket",
      type: "support_response",
      data: {
        ticketId: ticket._id.toString(),
      },
    });

    return res
      .status(200)
      .json(GenRes(200, ticket, null, "Support ticket handled successfully"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

module.exports = {
  GetUsers,
  GetUserDetails,
  AddVendor,
  GetUserStats,
  GetLeaderboard,
  BanUser,
  GetVendorStats,
  DeleteUserContent,
  HandleAdRequest,
  GetAdStats,
  GetReports,
  HandleReport,
  GetSupportTickets,
  HandleSupportTicket,
};
