const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const Like = require("./likes.model");
const User = require("../user/user.model");
const Content = require("../contents/contents.model");
const Video = require("../../modules/video/video.model");
const Notification = require("../notifications/notification.model");
const Course = require("../courses/courses.model");

const LikeHandler = async (req, res) => {
  try {
    const body = req?.body;

    if (!Array.isArray(body) || body.length === 0) {
      throw new Error("BODY must be an array with at least 1 item!");
    }

    const userEmail = req?.user?.email;
    if (!userEmail) {
      throw new Error("User email not found in request!");
    }

    const getUser = await User.findOne({ email: userEmail }).select(
      "_id name email picture"
    );

    if (!getUser) {
      throw new Error("User not found!");
    }

    const notifications = [];

    for (const data of body) {
      const { uid, type } = data;

      if (
        !uid ||
        !isValidObjectId(uid) ||
        !type ||
        !["content", "course", "video", "reel"].includes(type)
      ) {
        const response = GenRes(
          400,
          null,
          { error: "INVALID DATA TYPE" },
          "Invalid data. 'type' must be 'content', 'course', 'video', or 'reel', and valid 'uid' required!"
        );
        return res.status(400).json(response);
      }

      let itemExists;
      let itemType = type;

      // Check if the item exists based on type
      if (type === "content") {
        itemExists = await Content.findById(uid);
      } else if (type === "course") {
        itemExists = await Course.findById(uid);
      } else if (type === "video" || type === "reel") {
        itemExists = await Video.findById(uid);
        // For videos and reels, we'll store the like type as "video" in the database
        itemType = "video";
      }

      if (!itemExists) {
        throw new Error(`This ${type} no longer exists!`);
      }

      const deleted = await Like.findOneAndDelete({
        uid,
        "user.email": userEmail,
        type: itemType,
      });

      if (!deleted) {
        const newLike = new Like({
          type: itemType,
          uid,
          user: getUser.toObject(),
        });
        await newLike.save();

        // Create notification object with enhanced metadata for redirection
        const notification = new Notification({
          recipient: {
            _id: itemExists.author._id,
            email: itemExists.author.email,
          },
          sender: {
            _id: getUser._id,
            email: getUser.email,
            name: getUser.name,
            picture: getUser.picture,
          },
          type: "like",
          content: `${getUser.name} liked your ${type}`,
          priority: "medium",
          metadata: {
            itemId: uid,
            itemType: type,
            contentTitle: itemExists.title || itemExists.status || "content",
            redirectUrl: generateRedirectUrl(type, uid),
            redirectType: "post",
            additionalInfo: {
              likeId: newLike._id.toString(),
              timestamp: new Date(),
            },
          },
          actionData: {
            action: "like",
            targetType: type,
            targetId: uid,
            contextText: `${getUser.name} liked your ${type}`,
          },
        });

        // Save notification
        await notification.save();
        notifications.push(notification);
      }
    }

    // Handle real-time notifications after all operations are complete
    const io = req.app.get("io");
    if (io && notifications.length > 0) {
      const notificationsByRecipient = notifications.reduce(
        (acc, notification) => {
          const recipientId = notification.recipient._id;
          if (!acc[recipientId]) {
            acc[recipientId] = [];
          }
          acc[recipientId].push(notification);
          return acc;
        },
        {}
      );

      // Send notifications to each recipient
      Object.entries(notificationsByRecipient).forEach(
        ([recipientId, recipientNotifications]) => {
          io.to(recipientId).emit("new_notifications", recipientNotifications);
        }
      );
    }

    const response = GenRes(
      200,
      null,
      null,
      "Like/Unlike operation completed!"
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(
      500,
      null,
      { error: error?.message || "Unknown error" },
      error?.message || "Server Error"
    );
    return res.status(500).json(response);
  }
};

// Helper function to generate redirect URLs
const generateRedirectUrl = (type, itemId) => {
  const baseUrl = "/api/v1";

  switch (type) {
    case "content":
      return `${baseUrl}/content/${itemId}`;
    case "video":
    case "reel":
      return `${baseUrl}/video/${itemId}`;
    case "course":
      return `${baseUrl}/course/${itemId}`;
    default:
      return `${baseUrl}/home`;
  }
};

module.exports = LikeHandler;
