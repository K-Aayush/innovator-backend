const Notification = require("./notification.model");
const GenRes = require("../../utils/routers/GenRes");

const GetNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = 20;

    const notifications = await Notification.find({
      "recipient._id": req.user._id,
    })
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit);

    const unreadCount = await Notification.countDocuments({
      "recipient._id": req.user._id,
      read: false,
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { notifications, unreadCount },
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

    await Notification.updateMany(
      {
        _id: { $in: notificationIds },
        "recipient._id": req.user._id,
      },
      { $set: { read: true } }
    );

    return res
      .status(200)
      .json(GenRes(200, null, null, "Notifications marked as read"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

const MarkAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      {
        "recipient._id": req.user._id,
        read: false,
      },
      { $set: { read: true } }
    );

    return res
      .status(200)
      .json(GenRes(200, null, null, "All notifications marked as read"));
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
      .json(GenRes(200, null, null, "Notification deleted"));
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
