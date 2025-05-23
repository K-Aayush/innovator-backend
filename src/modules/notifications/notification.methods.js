const Notification = require("./notification.model");
const FCMHandler = require("../../utils/notifications/fcmHandler");
const GenRes = require("../../utils/routers/GenRes");

const GetNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = 20;
    const lastId = req.query.lastId;

    // Base query
    const query = { "recipient._id": req.user._id };

    // Add cursor-based pagination
    if (lastId) {
      query._id = { $lt: lastId };
    }

    // Get notifications with pagination
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit + 1);

    const hasMore = notifications.length > limit;
    const results = hasMore ? notifications.slice(0, -1) : notifications;

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      "recipient._id": req.user._id,
      read: false,
    });

    // Send FCM notification for unread notifications
    if (unreadCount > 0) {
      await FCMHandler.sendToUser(req.user._id, {
        title: "New Notifications",
        body: `You have ${unreadCount} unread notifications`,
        type: "notification_count",
        data: {
          unreadCount: unreadCount.toString(),
        },
      });
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          notifications: results,
          unreadCount,
          hasMore,
          nextCursor: hasMore ? results[results.length - 1]._id : null,
        },
        null,
        "Notifications retrieved"
      )
    );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

const MarkAsRead = async (req, res) => {
  try {
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid notification IDs" },
            "Invalid request"
          )
        );
    }

    const updatedNotifications = await Notification.updateMany(
      {
        _id: { $in: notificationIds },
        "recipient._id": req.user._id,
      },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      }
    );

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { modifiedCount: updatedNotifications.modifiedCount },
          null,
          "Notifications marked as read"
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

const MarkAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      {
        recipient: req.user._id, // fixed here
        read: false,
      },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      }
    );

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { modifiedCount: result.modifiedCount },
          null,
          "All notifications marked as read"
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

const DeleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Notification.findOneAndDelete({
      _id: id,
      "recipient._id": req.user._id,
    });

    if (!deleted) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Notification not found" }, "Not found")
        );
    }

    return res
      .status(200)
      .json(GenRes(200, deleted, null, "Notification deleted"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

module.exports = {
  GetNotifications,
  MarkAsRead,
  MarkAllAsRead,
  DeleteNotification,
};
