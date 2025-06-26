const Event = require("./event.model");
const User = require("../user/user.model");
const Notification = require("../notifications/notification.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const path = require("path");
const fs = require("fs");

// Create new event (Admin only)
const CreateEvent = async (req, res) => {
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
            "Only admins can create events"
          )
        );
    }

    const data = req.body;
    const images = req.file_locations || [];

    // Get admin details
    const admin = await User.findById(req.user._id)
      .select("name email _id")
      .lean();

    if (!admin) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Admin not found" }, "Admin not found")
        );
    }

    // Validate dates
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const now = new Date();

    if (startDate < now) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Start date cannot be in the past" },
            "Invalid start date"
          )
        );
    }

    if (endDate <= startDate) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "End date must be after start date" },
            "Invalid end date"
          )
        );
    }

    // Create event object
    const eventData = {
      title: data.title,
      description: data.description,
      eventMaker: {
        _id: admin._id,
        email: admin.email,
        name: admin.name,
      },
      category: data.category,
      location: {
        venue: data.location?.venue || data.venue,
        address: data.location?.address || data.address,
        city: data.location?.city || data.city,
        country: data.location?.country || data.country,
        isOnline: data.location?.isOnline || data.isOnline || false,
        onlineLink: data.location?.onlineLink || data.onlineLink,
        coordinates: data.location?.coordinates || data.coordinates,
      },
      startDate,
      endDate,
      maxAttendees: data.maxAttendees ? parseInt(data.maxAttendees) : undefined,
      registrationRequired: data.registrationRequired !== false,
      registrationDeadline: data.registrationDeadline
        ? new Date(data.registrationDeadline)
        : undefined,
      images,
      tags: Array.isArray(data.tags) ? data.tags : [],
      price: {
        amount: data.price?.amount || data.priceAmount || 0,
        currency: data.price?.currency || data.priceCurrency || "USD",
        isFree:
          data.price?.isFree !== false &&
          (!data.price?.amount || data.price?.amount === 0),
      },
      contactInfo: {
        email: data.contactInfo?.email || data.contactEmail || admin.email,
        phone: data.contactInfo?.phone || data.contactPhone,
        website: data.contactInfo?.website || data.contactWebsite,
      },
      requirements: Array.isArray(data.requirements) ? data.requirements : [],
      agenda: Array.isArray(data.agenda) ? data.agenda : [],
      isPublic: data.isPublic !== false,
      featured: data.featured === true,
    };

    const newEvent = new Event(eventData);
    await newEvent.save();

    // Create notifications for all users about new event (if public and featured)
    if (newEvent.isPublic && newEvent.featured) {
      const users = await User.find({ role: "user" })
        .select("_id email")
        .limit(100);

      const notifications = users.map((user) => ({
        recipient: {
          _id: user._id,
          email: user.email,
        },
        sender: {
          _id: admin._id,
          email: admin.email,
          name: admin.name,
        },
        type: "event",
        content: `New featured event: ${newEvent.title}`,
        metadata: {
          itemId: newEvent._id.toString(),
          itemType: "event",
          eventTitle: newEvent.title,
          eventDate: newEvent.startDate,
        },
      }));

      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
    }

    return res
      .status(201)
      .json(GenRes(201, newEvent, null, "Event created successfully"));
  } catch (error) {
    console.error("Error creating event:", error);

    // Clean up uploaded files if event creation fails
    if (req.file_locations?.length > 0) {
      for (const file of req.file_locations) {
        try {
          fs.unlinkSync(path.join(process.cwd(), file.slice(1)));
        } catch (cleanupError) {
          console.log(
            `Failed to clean up file ${file}:`,
            cleanupError?.message
          );
        }
      }
    }

    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get all events with filtering and pagination
const GetEvents = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 20,
      category,
      status,
      location,
      search,
      featured,
      upcoming,
      startDate,
      endDate,
    } = req.query;

    const pageNum = parseInt(page, 10) || 0;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50);

    // Build filters
    const filters = { isPublic: true };

    if (category) {
      filters.category = category;
    }

    if (status) {
      filters.status = status;
    }

    if (featured === "true") {
      filters.featured = true;
    }

    if (upcoming === "true") {
      filters.startDate = { $gte: new Date() };
      filters.status = { $in: ["upcoming", "ongoing"] };
    }

    if (location) {
      filters.$or = [
        { "location.city": { $regex: location, $options: "i" } },
        { "location.country": { $regex: location, $options: "i" } },
        { "location.venue": { $regex: location, $options: "i" } },
      ];
    }

    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    if (startDate || endDate) {
      filters.startDate = {};
      if (startDate) filters.startDate.$gte = new Date(startDate);
      if (endDate) filters.startDate.$lte = new Date(endDate);
    }

    // Get events with pagination
    const [events, total] = await Promise.all([
      Event.find(filters)
        .sort({ featured: -1, startDate: 1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      Event.countDocuments(filters),
    ]);

    const hasMore = (pageNum + 1) * limitNum < total;

    return res.status(200).json(
      GenRes(
        200,
        {
          events,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum),
            hasMore,
          },
        },
        null,
        `Retrieved ${events.length} events`
      )
    );
  } catch (error) {
    console.error("Error getting events:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get single event by ID
const GetEventById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid event ID" }, "Invalid event ID")
        );
    }

    const event = await Event.findById(id).lean();

    if (!event) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Event not found" }, "Event not found")
        );
    }

    // Check if user can view this event
    if (!event.isPublic && req.user?.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(403, null, { error: "Access denied" }, "Event is private")
        );
    }

    return res
      .status(200)
      .json(GenRes(200, event, null, "Event retrieved successfully"));
  } catch (error) {
    console.error("Error getting event:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update event (Admin only)
const UpdateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update events"
          )
        );
    }

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid event ID" }, "Invalid event ID")
        );
    }

    const event = await Event.findById(id);

    if (!event) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Event not found" }, "Event not found")
        );
    }

    // Validate dates if provided
    if (data.startDate || data.endDate) {
      const startDate = data.startDate
        ? new Date(data.startDate)
        : event.startDate;
      const endDate = data.endDate ? new Date(data.endDate) : event.endDate;

      if (endDate <= startDate) {
        return res
          .status(400)
          .json(
            GenRes(
              400,
              null,
              { error: "End date must be after start date" },
              "Invalid dates"
            )
          );
      }
    }

    // Update fields
    const updateFields = {};

    if (data.title) updateFields.title = data.title;
    if (data.description) updateFields.description = data.description;
    if (data.category) updateFields.category = data.category;
    if (data.startDate) updateFields.startDate = new Date(data.startDate);
    if (data.endDate) updateFields.endDate = new Date(data.endDate);
    if (data.status) updateFields.status = data.status;
    if (data.maxAttendees !== undefined)
      updateFields.maxAttendees = parseInt(data.maxAttendees);
    if (data.registrationRequired !== undefined)
      updateFields.registrationRequired = data.registrationRequired;
    if (data.registrationDeadline)
      updateFields.registrationDeadline = new Date(data.registrationDeadline);
    if (data.isPublic !== undefined) updateFields.isPublic = data.isPublic;
    if (data.featured !== undefined) updateFields.featured = data.featured;
    if (data.tags)
      updateFields.tags = Array.isArray(data.tags) ? data.tags : [];
    if (data.requirements)
      updateFields.requirements = Array.isArray(data.requirements)
        ? data.requirements
        : [];
    if (data.agenda)
      updateFields.agenda = Array.isArray(data.agenda) ? data.agenda : [];

    // Update nested objects
    if (data.location) {
      updateFields.location = {
        ...event.location.toObject(),
        ...data.location,
      };
    }
    if (data.price) {
      updateFields.price = { ...event.price.toObject(), ...data.price };
    }
    if (data.contactInfo) {
      updateFields.contactInfo = {
        ...event.contactInfo.toObject(),
        ...data.contactInfo,
      };
    }

    // Handle new images
    if (req.file_locations?.length > 0) {
      // Delete old images
      if (event.images?.length > 0) {
        for (const oldImage of event.images) {
          try {
            fs.unlinkSync(path.join(process.cwd(), oldImage.slice(1)));
          } catch (error) {
            console.log(
              `Failed to delete old image ${oldImage}:`,
              error?.message
            );
          }
        }
      }
      updateFields.images = req.file_locations;
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    return res
      .status(200)
      .json(GenRes(200, updatedEvent, null, "Event updated successfully"));
  } catch (error) {
    console.error("Error updating event:", error);

    // Clean up uploaded files if update fails
    if (req.file_locations?.length > 0) {
      for (const file of req.file_locations) {
        try {
          fs.unlinkSync(path.join(process.cwd(), file.slice(1)));
        } catch (cleanupError) {
          console.log(
            `Failed to clean up file ${file}:`,
            cleanupError?.message
          );
        }
      }
    }

    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete event (Admin only)
const DeleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete events"
          )
        );
    }

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid event ID" }, "Invalid event ID")
        );
    }

    const event = await Event.findById(id);

    if (!event) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Event not found" }, "Event not found")
        );
    }

    // Delete associated images
    if (event.images?.length > 0) {
      for (const image of event.images) {
        try {
          fs.unlinkSync(path.join(process.cwd(), image.slice(1)));
        } catch (error) {
          console.log(`Failed to delete image ${image}:`, error?.message);
        }
      }
    }

    await Event.findByIdAndDelete(id);

    return res
      .status(200)
      .json(GenRes(200, null, null, "Event deleted successfully"));
  } catch (error) {
    console.error("Error deleting event:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get events by admin (Admin only)
const GetAdminEvents = async (req, res) => {
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
            "Only admins can view admin events"
          )
        );
    }

    const { page = 0, limit = 20, status, search } = req.query;

    const pageNum = parseInt(page, 10) || 0;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50);

    // Build filters for admin's events
    const filters = { "eventMaker._id": req.user._id };

    if (status) {
      filters.status = status;
    }

    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const [events, total] = await Promise.all([
      Event.find(filters)
        .sort({ createdAt: -1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      Event.countDocuments(filters),
    ]);

    const hasMore = (pageNum + 1) * limitNum < total;

    return res.status(200).json(
      GenRes(
        200,
        {
          events,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum),
            hasMore,
          },
        },
        null,
        `Retrieved ${events.length} admin events`
      )
    );
  } catch (error) {
    console.error("Error getting admin events:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update event status manually (Admin only)
const UpdateEventStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can update event status"
          )
        );
    }

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid event ID" }, "Invalid event ID")
        );
    }

    if (!["upcoming", "ongoing", "completed", "cancelled"].includes(status)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid status" }, "Invalid status value")
        );
    }

    const event = await Event.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true, runValidators: true }
    );

    if (!event) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Event not found" }, "Event not found")
        );
    }

    return res
      .status(200)
      .json(GenRes(200, event, null, "Event status updated successfully"));
  } catch (error) {
    console.error("Error updating event status:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  CreateEvent,
  GetEvents,
  GetEventById,
  UpdateEvent,
  DeleteEvent,
  GetAdminEvents,
  UpdateEventStatus,
};
