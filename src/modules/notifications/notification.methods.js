const Notification = require("./notification.model");
const Content = require("../contents/contents.model");
const Video = require("../video/video.model");
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

    // Enrich notifications with redirect URLs for Facebook-like behavior
    const enrichedNotifications = await Promise.all(
      results.map(async (notification) => {
        const notificationObj = notification.toObject();

        // Generate redirect URL based on notification type and metadata
        if (notification.metadata?.itemId && notification.metadata?.itemType) {
          notificationObj.redirectUrl = generateRedirectUrl(
            notification.metadata.itemType,
            notification.metadata.itemId,
            notification.type,
            notification.metadata
          );
        }

        // Add action data for better UI handling
        notificationObj.actionData = {
          action: notification.type,
          targetType: notification.metadata?.itemType || "unknown",
          targetId: notification.metadata?.itemId,
          contextText: generateContextText(notification),
        };

        return notificationObj;
      })
    );

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      "recipient._id": req.user._id,
      read: false,
    });

    return res.status(200).json(
      GenRes(
        200,
        {
          notifications: enrichedNotifications,
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

// Generate Facebook-like redirect URLs
const generateRedirectUrl = (itemType, itemId, notificationType, metadata) => {
  const baseUrl = "/api/v1"; // Adjust based on your frontend routing

  switch (itemType) {
    case "content":
      if (notificationType === "comment" && metadata.commentId) {
        return `${baseUrl}/content/${itemId}?comment=${metadata.commentId}`;
      }
      return `${baseUrl}/content/${itemId}`;

    case "video":
    case "reel":
      if (notificationType === "comment" && metadata.commentId) {
        return `${baseUrl}/video/${itemId}?comment=${metadata.commentId}`;
      }
      return `${baseUrl}/video/${itemId}`;

    case "course":
      return `${baseUrl}/course/${itemId}`;

    case "shop":
      return `${baseUrl}/product/${itemId}`;

    case "profile":
      return `${baseUrl}/profile/${itemId}`;

    case "message":
      return `${baseUrl}/chat/${metadata.senderId || itemId}`;

    default:
      return `${baseUrl}/home`;
  }
};

// Generate context text for notifications
const generateContextText = (notification) => {
  const senderName = notification.sender.name;
  const type = notification.type;

  switch (type) {
    case "like":
      return `${senderName} liked your post`;
    case "comment":
      return `${senderName} commented on your post`;
    case "share":
      return `${senderName} shared your post`;
    case "follow":
      return `${senderName} started following you`;
    case "message":
      return `New message from ${senderName}`;
    default:
      return notification.content;
  }
};

// Handle notification click - mark as read and return redirect info
const HandleNotificationClick = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        "recipient._id": req.user._id,
      },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      },
      { new: true }
    );

    if (!notification) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Notification not found" }, "Not found")
        );
    }

    // Generate redirect information
    const redirectInfo = {
      url: generateRedirectUrl(
        notification.metadata?.itemType,
        notification.metadata?.itemId,
        notification.type,
        notification.metadata
      ),
      type: notification.metadata?.itemType || "unknown",
      itemId: notification.metadata?.itemId,
      action: notification.type,
    };

    // Verify the target still exists
    let targetExists = true;
    if (notification.metadata?.itemId && notification.metadata?.itemType) {
      targetExists = await verifyTargetExists(
        notification.metadata.itemType,
        notification.metadata.itemId
      );
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          notification: notification.toObject(),
          redirect: redirectInfo,
          targetExists,
        },
        null,
        "Notification clicked"
      )
    );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Verify if the notification target still exists
const verifyTargetExists = async (itemType, itemId) => {
  try {
    switch (itemType) {
      case "content":
        const content = await Content.findById(itemId).select("_id").lean();
        return !!content;

      case "video":
      case "reel":
        const video = await Video.findById(itemId).select("_id").lean();
        return !!video;

      // Add other types as needed
      default:
        return true; // Assume exists for unknown types
    }
  } catch (error) {
    console.error("Error verifying target exists:", error);
    return false;
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
        "recipient._id": req.user._id,
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

const DeleteAllNotifications = async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      "recipient._id": req.user._id,
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { deletedCount: result.deletedCount },
          null,
          "All notifications deleted"
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

module.exports = {
  GetNotifications,
  HandleNotificationClick,
  MarkAsRead,
  MarkAllAsRead,
  DeleteNotification,
  DeleteAllNotifications,
};
