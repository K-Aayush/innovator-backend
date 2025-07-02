const EventRegistration = require("./eventRegistration.model");
const Event = require("./event.model");
const User = require("../user/user.model");
const Notification = require("../notifications/notification.model");
const transporter = require("../../config/Mailer");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const FCMHandler = require("../../utils/notification/fcmHandler");

// Register for an event
const RegisterForEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const registrationData = req.body;
    const user = req.user;

    if (!isValidObjectId(eventId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid event ID" }, "Invalid event ID")
        );
    }

    // Get event details
    const event = await Event.findById(eventId);
    if (!event) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Event not found" }, "Event not found")
        );
    }

    // Check if event is still accepting registrations
    const now = new Date();
    if (event.registrationDeadline && now > event.registrationDeadline) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Registration deadline passed" },
            "Registration deadline has passed"
          )
        );
    }

    if (event.status === "completed" || event.status === "cancelled") {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Event not available for registration" },
            "Event is not available for registration"
          )
        );
    }

    // Check if user already registered
    const existingRegistration = await EventRegistration.findOne({
      "event._id": eventId,
      "registrant.email": registrationData.email,
    });

    if (existingRegistration) {
      return res
        .status(409)
        .json(
          GenRes(
            409,
            null,
            { error: "Already registered" },
            "You are already registered for this event"
          )
        );
    }

    // Check available seats
    const currentRegistrations = await EventRegistration.countDocuments({
      "event._id": eventId,
      "registrationDetails.status": { $in: ["confirmed", "pending"] },
    });

    let registrationStatus = "confirmed";
    if (event.maxAttendees && currentRegistrations >= event.maxAttendees) {
      registrationStatus = "waitlisted";
    }

    // Validate required fields
    const requiredFields = ["name", "email", "phone", "type"];
    const missingFields = requiredFields.filter(
      (field) => !registrationData[field]
    );

    if (missingFields.length > 0) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Missing required fields", fields: missingFields },
            `Missing required fields: ${missingFields.join(", ")}`
          )
        );
    }

    // Create registration
    const registration = new EventRegistration({
      event: {
        _id: event._id,
        title: event.title,
        startDate: event.startDate,
        endDate: event.endDate,
        location: event.location,
      },
      registrant: {
        name: registrationData.name,
        email: registrationData.email.toLowerCase(),
        phone: registrationData.phone,
        type: registrationData.type,
        organization: registrationData.organization || "",
        designation: registrationData.designation || "",
        location: {
          address: registrationData.address || "",
          city: registrationData.city,
          state: registrationData.state || "",
          country: registrationData.country,
          zipCode: registrationData.zipCode || "",
        },
        emergencyContact: registrationData.emergencyContact || {},
      },
      registrationDetails: {
        status: registrationStatus,
        paymentAmount: event.price?.amount || 0,
        specialRequirements: registrationData.specialRequirements || "",
        dietaryRestrictions: registrationData.dietaryRestrictions || "",
        accessibilityNeeds: registrationData.accessibilityNeeds || "",
      },
      metadata: {
        source: "website",
        userAgent: req.headers["user-agent"],
        ipAddress: req.ip,
        referralCode: registrationData.referralCode || "",
        marketingConsent: registrationData.marketingConsent || false,
      },
    });

    await registration.save();

    // Send confirmation email to registrant
    await sendRegistrationConfirmationEmail(registration, event);

    // Send notification email to admin
    await sendAdminNotificationEmail(registration, event);

    // Create notification for event organizer
    const eventOrganizer = await User.findById(event.eventMaker._id);
    if (eventOrganizer) {
      const notification = new Notification({
        recipient: {
          _id: eventOrganizer._id,
          email: eventOrganizer.email,
        },
        sender: {
          _id: user?._id || "system",
          email: registration.registrant.email,
          name: registration.registrant.name,
        },
        type: "event",
        content: `New registration for ${event.title}`,
        metadata: {
          itemId: event._id.toString(),
          itemType: "event",
          registrationId: registration._id.toString(),
          registrationStatus,
        },
      });

      await notification.save();

      // Send FCM notification to event organizer
      try {
        await FCMHandler.sendToUser(eventOrganizer._id, {
          title: "New Event Registration",
          body: `${registration.registrant.name} registered for ${event.title}`,
          type: "event_registration",
          data: {
            eventId: event._id.toString(),
            registrationId: registration._id.toString(),
          },
        });
      } catch (fcmError) {
        console.error("Failed to send FCM notification:", fcmError);
      }
    }

    return res.status(201).json(
      GenRes(
        201,
        {
          registration: {
            _id: registration._id,
            registrationNumber:
              registration.registrationDetails.registrationNumber,
            status: registration.registrationDetails.status,
            event: registration.event,
            registrant: registration.registrant,
          },
          message:
            registrationStatus === "waitlisted"
              ? "You have been added to the waitlist"
              : "Registration confirmed",
        },
        null,
        "Registration successful"
      )
    );
  } catch (error) {
    console.error("Error registering for event:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's event registrations
const GetUserRegistrations = async (req, res) => {
  try {
    const { email } = req.query;
    const userEmail = email || req.user?.email;

    if (!userEmail) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Email required" }, "Email is required")
        );
    }

    const registrations = await EventRegistration.find({
      "registrant.email": userEmail.toLowerCase(),
    })
      .sort({ "registrationDetails.registrationDate": -1 })
      .lean();

    return res
      .status(200)
      .json(
        GenRes(
          200,
          registrations,
          null,
          `Retrieved ${registrations.length} registrations`
        )
      );
  } catch (error) {
    console.error("Error getting user registrations:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get event registrations (Admin only)
const GetEventRegistrations = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, page = 0, limit = 50, search } = req.query;

    // Check if user is admin or event organizer
    if (req.user.role !== "admin") {
      const event = await Event.findById(eventId);
      if (!event || event.eventMaker._id !== req.user._id) {
        return res
          .status(403)
          .json(
            GenRes(
              403,
              null,
              { error: "Not authorized" },
              "Only admins or event organizers can view registrations"
            )
          );
      }
    }

    if (!isValidObjectId(eventId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid event ID" }, "Invalid event ID")
        );
    }

    const pageNum = parseInt(page, 10) || 0;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

    // Build filters
    const filters = { "event._id": eventId };

    if (status) {
      filters["registrationDetails.status"] = status;
    }

    if (search) {
      filters.$or = [
        { "registrant.name": { $regex: search, $options: "i" } },
        { "registrant.email": { $regex: search, $options: "i" } },
        { "registrant.organization": { $regex: search, $options: "i" } },
        {
          "registrationDetails.registrationNumber": {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const [registrations, total] = await Promise.all([
      EventRegistration.find(filters)
        .sort({ "registrationDetails.registrationDate": -1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      EventRegistration.countDocuments(filters),
    ]);

    // Get statistics
    const stats = await EventRegistration.aggregate([
      { $match: { "event._id": eventId } },
      {
        $group: {
          _id: "$registrationDetails.status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statistics = {
      total: await EventRegistration.countDocuments({ "event._id": eventId }),
      confirmed: 0,
      pending: 0,
      waitlisted: 0,
      cancelled: 0,
    };

    stats.forEach((stat) => {
      statistics[stat._id] = stat.count;
    });

    return res.status(200).json(
      GenRes(
        200,
        {
          registrations,
          statistics,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum),
            hasMore: (pageNum + 1) * limitNum < total,
          },
        },
        null,
        `Retrieved ${registrations.length} registrations`
      )
    );
  } catch (error) {
    console.error("Error getting event registrations:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update registration status (Admin only)
const UpdateRegistrationStatus = async (req, res) => {
  try {
    const { registrationId } = req.params;
    const { status, notes } = req.body;

    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update registration status"
          )
        );
    }

    if (!isValidObjectId(registrationId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid registration ID" },
            "Invalid registration ID"
          )
        );
    }

    const validStatuses = ["pending", "confirmed", "cancelled", "waitlisted"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid status" },
            "Invalid registration status"
          )
        );
    }

    const registration = await EventRegistration.findByIdAndUpdate(
      registrationId,
      {
        $set: {
          "registrationDetails.status": status,
          "registrationDetails.notes": notes || "",
        },
      },
      { new: true }
    );

    if (!registration) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Registration not found" },
            "Registration not found"
          )
        );
    }

    // Send status update email
    await sendStatusUpdateEmail(registration, status);

    return res
      .status(200)
      .json(
        GenRes(
          200,
          registration,
          null,
          "Registration status updated successfully"
        )
      );
  } catch (error) {
    console.error("Error updating registration status:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Check-in attendee (Admin only)
const CheckInAttendee = async (req, res) => {
  try {
    const { registrationId } = req.params;

    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can check-in attendees"
          )
        );
    }

    const registration = await EventRegistration.findByIdAndUpdate(
      registrationId,
      {
        $set: {
          "attendance.checkedIn": true,
          "attendance.checkInTime": new Date(),
          "attendance.checkInBy": req.user.email,
        },
      },
      { new: true }
    );

    if (!registration) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Registration not found" },
            "Registration not found"
          )
        );
    }

    return res
      .status(200)
      .json(
        GenRes(200, registration, null, "Attendee checked in successfully")
      );
  } catch (error) {
    console.error("Error checking in attendee:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Cancel registration
const CancelRegistration = async (req, res) => {
  try {
    const { registrationId } = req.params;
    const { reason } = req.body;

    if (!isValidObjectId(registrationId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid registration ID" },
            "Invalid registration ID"
          )
        );
    }

    const registration = await EventRegistration.findById(registrationId);
    if (!registration) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Registration not found" },
            "Registration not found"
          )
        );
    }

    // Check if user can cancel (own registration or admin)
    if (
      req.user.role !== "admin" &&
      registration.registrant.email !== req.user.email
    ) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "You can only cancel your own registration"
          )
        );
    }

    // Update registration status
    registration.registrationDetails.status = "cancelled";
    registration.registrationDetails.cancellationReason = reason || "";
    registration.registrationDetails.cancellationDate = new Date();
    await registration.save();

    // Send cancellation email
    await sendCancellationEmail(registration);

    // If there's a waitlist, promote the next person
    await promoteFromWaitlist(registration.event._id);

    return res
      .status(200)
      .json(
        GenRes(200, registration, null, "Registration cancelled successfully")
      );
  } catch (error) {
    console.error("Error cancelling registration:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Helper function to send registration confirmation email
async function sendRegistrationConfirmationEmail(registration, event) {
  try {
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
        <h2 style="color: #4A90E2;">Event Registration Confirmation</h2>
        
        <p>Dear ${registration.registrant.name},</p>
        
        <p>Thank you for registering for <strong>${event.title}</strong>!</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Registration Details:</h3>
          <p><strong>Registration Number:</strong> ${
            registration.registrationDetails.registrationNumber
          }</p>
          <p><strong>Status:</strong> ${
            registration.registrationDetails.status
          }</p>
          <p><strong>Event:</strong> ${event.title}</p>
          <p><strong>Date:</strong> ${event.startDate.toLocaleDateString()} - ${event.endDate.toLocaleDateString()}</p>
          <p><strong>Time:</strong> ${event.startDate.toLocaleTimeString()} - ${event.endDate.toLocaleTimeString()}</p>
          <p><strong>Venue:</strong> ${event.location.venue}</p>
          <p><strong>Address:</strong> ${event.location.address}, ${
      event.location.city
    }</p>
        </div>
        
        <div style="background-color: #e8f4fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Your Information:</h3>
          <p><strong>Name:</strong> ${registration.registrant.name}</p>
          <p><strong>Email:</strong> ${registration.registrant.email}</p>
          <p><strong>Phone:</strong> ${registration.registrant.phone}</p>
          <p><strong>Type:</strong> ${registration.registrant.type}</p>
          ${
            registration.registrant.organization
              ? `<p><strong>Organization:</strong> ${registration.registrant.organization}</p>`
              : ""
          }
        </div>
        
        ${
          registration.registrationDetails.status === "waitlisted"
            ? '<div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;"><p><strong>Note:</strong> You are currently on the waitlist. We will notify you if a spot becomes available.</p></div>'
            : '<div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0;"><p><strong>Your registration is confirmed!</strong> Please save this email for your records.</p></div>'
        }
        
        <p>If you have any questions, please contact us at ${
          event.contactInfo?.email || process.env.EMAIL
        }.</p>
        
        <p>We look forward to seeing you at the event!</p>
        
        <p>Best regards,<br>The Event Team</p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL,
      to: registration.registrant.email,
      subject: `Registration Confirmation - ${event.title}`,
      html: emailHtml,
    });
  } catch (error) {
    console.error("Error sending confirmation email:", error);
  }
}

// Helper function to send admin notification email
async function sendAdminNotificationEmail(registration, event) {
  try {
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
        <h2 style="color: #4A90E2;">New Event Registration</h2>
        
        <p>A new registration has been received for <strong>${
          event.title
        }</strong>.</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Registration Details:</h3>
          <p><strong>Registration Number:</strong> ${
            registration.registrationDetails.registrationNumber
          }</p>
          <p><strong>Status:</strong> ${
            registration.registrationDetails.status
          }</p>
          <p><strong>Registration Date:</strong> ${registration.registrationDetails.registrationDate.toLocaleString()}</p>
        </div>
        
        <div style="background-color: #e8f4fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Registrant Information:</h3>
          <p><strong>Name:</strong> ${registration.registrant.name}</p>
          <p><strong>Email:</strong> ${registration.registrant.email}</p>
          <p><strong>Phone:</strong> ${registration.registrant.phone}</p>
          <p><strong>Type:</strong> ${registration.registrant.type}</p>
          ${
            registration.registrant.organization
              ? `<p><strong>Organization:</strong> ${registration.registrant.organization}</p>`
              : ""
          }
          ${
            registration.registrant.designation
              ? `<p><strong>Designation:</strong> ${registration.registrant.designation}</p>`
              : ""
          }
          <p><strong>Location:</strong> ${
            registration.registrant.location.city
          }, ${registration.registrant.location.country}</p>
        </div>
        
        ${
          registration.registrationDetails.specialRequirements
            ? `<div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Special Requirements:</h3>
            <p>${registration.registrationDetails.specialRequirements}</p>
          </div>`
            : ""
        }
        
        ${
          registration.registrationDetails.dietaryRestrictions
            ? `<div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Dietary Restrictions:</h3>
            <p>${registration.registrationDetails.dietaryRestrictions}</p>
          </div>`
            : ""
        }
        
        <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Event Details:</h3>
          <p><strong>Event:</strong> ${event.title}</p>
          <p><strong>Date:</strong> ${event.startDate.toLocaleDateString()} - ${event.endDate.toLocaleDateString()}</p>
          <p><strong>Venue:</strong> ${event.location.venue}</p>
        </div>
        
        <p>Please review the registration and take appropriate action if needed.</p>
        
        <p>Best regards,<br>Event Management System</p>
      </div>
    `;

    // Send to event organizer
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: event.eventMaker.email,
      subject: `New Registration - ${event.title}`,
      html: emailHtml,
    });

    // Also send to admin email if different
    if (
      process.env.ADMIN_EMAIL &&
      process.env.ADMIN_EMAIL !== event.eventMaker.email
    ) {
      await transporter.sendMail({
        from: process.env.EMAIL,
        to: process.env.ADMIN_EMAIL,
        subject: `New Registration - ${event.title}`,
        html: emailHtml,
      });
    }
  } catch (error) {
    console.error("Error sending admin notification email:", error);
  }
}

// Helper function to send status update email
async function sendStatusUpdateEmail(registration, newStatus) {
  try {
    const statusMessages = {
      confirmed: "Your registration has been confirmed!",
      cancelled: "Your registration has been cancelled.",
      waitlisted: "You have been moved to the waitlist.",
      pending: "Your registration is pending review.",
    };

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
        <h2 style="color: #4A90E2;">Registration Status Update</h2>
        
        <p>Dear ${registration.registrant.name},</p>
        
        <p>${statusMessages[newStatus]}</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Registration Details:</h3>
          <p><strong>Registration Number:</strong> ${registration.registrationDetails.registrationNumber}</p>
          <p><strong>Status:</strong> ${newStatus}</p>
          <p><strong>Event:</strong> ${registration.event.title}</p>
        </div>
        
        <p>If you have any questions, please contact us.</p>
        
        <p>Best regards,<br>The Event Team</p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL,
      to: registration.registrant.email,
      subject: `Registration Status Update - ${registration.event.title}`,
      html: emailHtml,
    });
  } catch (error) {
    console.error("Error sending status update email:", error);
  }
}

// Helper function to send cancellation email
async function sendCancellationEmail(registration) {
  try {
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
        <h2 style="color: #dc3545;">Registration Cancelled</h2>
        
        <p>Dear ${registration.registrant.name},</p>
        
        <p>Your registration for <strong>${
          registration.event.title
        }</strong> has been cancelled.</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3>Cancelled Registration:</h3>
          <p><strong>Registration Number:</strong> ${
            registration.registrationDetails.registrationNumber
          }</p>
          <p><strong>Event:</strong> ${registration.event.title}</p>
          <p><strong>Cancellation Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
        
        <p>If you have any questions about this cancellation, please contact us.</p>
        
        <p>Best regards,<br>The Event Team</p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL,
      to: registration.registrant.email,
      subject: `Registration Cancelled - ${registration.event.title}`,
      html: emailHtml,
    });
  } catch (error) {
    console.error("Error sending cancellation email:", error);
  }
}

// Helper function to promote from waitlist
async function promoteFromWaitlist(eventId) {
  try {
    const event = await Event.findById(eventId);
    if (!event || !event.maxAttendees) return;

    const confirmedCount = await EventRegistration.countDocuments({
      "event._id": eventId,
      "registrationDetails.status": "confirmed",
    });

    if (confirmedCount < event.maxAttendees) {
      const waitlistedRegistration = await EventRegistration.findOne({
        "event._id": eventId,
        "registrationDetails.status": "waitlisted",
      }).sort({ "registrationDetails.registrationDate": 1 });

      if (waitlistedRegistration) {
        waitlistedRegistration.registrationDetails.status = "confirmed";
        await waitlistedRegistration.save();

        // Send promotion email
        await sendStatusUpdateEmail(waitlistedRegistration, "confirmed");
      }
    }
  } catch (error) {
    console.error("Error promoting from waitlist:", error);
  }
}

module.exports = {
  RegisterForEvent,
  GetUserRegistrations,
  GetEventRegistrations,
  UpdateRegistrationStatus,
  CheckInAttendee,
  CancelRegistration,
};
