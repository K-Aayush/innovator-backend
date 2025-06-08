const GenRes = require("../../utils/routers/GenRes");
const Video = require("./video.model");
const Content = require("../contents/contents.model");
const User = require("../user/user.model");
const Notification = require("../notifications/notification.model");
const Follow = require("../follow/follow.model");

const ShareVideo = async (req, res) => {
  try {
    const { videoId, shareText, platform } = req.body;
    const user = req.user;

    if (!videoId) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Video ID required" }, "Video ID required")
        );
    }

    // Find the original video
    const originalVideo = await Video.findById(videoId).lean();
    if (!originalVideo) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Video not found" }, "Video not found")
        );
    }

    // Find the user
    const author = await User.findOne({ email: user.email })
      .select("picture name email uid _id")
      .lean();

    if (!author) {
      return res
        .status(401)
        .json(
          GenRes(
            401,
            null,
            { error: "User Authentication Failed" },
            "User Not Found"
          )
        );
    }

    // Create a shared content post
    const sharedContent = new Content({
      status: shareText || `Check out this ${originalVideo.type}!`,
      type: "share",
      author: author,
      isShared: true,
      originalContent: {
        _id: originalVideo._id,
        type: originalVideo.type,
        files: [originalVideo.videoUrl],
        status: originalVideo.title,
        author: originalVideo.author,
        createdAt: originalVideo.createdAt,
        thumbnail: originalVideo.thumbnail,
        duration: originalVideo.duration,
        videoUrl: originalVideo.videoUrl,
      },
      shareText: shareText,
    });

    await sharedContent.save();

    // Create notification for followers
    const followers = await Follow.find({ "following.email": author.email });

    const notifications = followers.map((follower) => ({
      recipient: {
        _id: follower.follower._id,
        email: follower.follower.email,
      },
      sender: {
        _id: author._id,
        email: author.email,
        name: author.name,
        picture: author.picture,
      },
      type: "share",
      content: `${author.name} shared a ${originalVideo.type}`,
      metadata: {
        itemId: sharedContent._id.toString(),
        itemType: "content",
        isShared: true,
        originalContentId: originalVideo._id,
        originalContentType: originalVideo.type,
      },
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);

      // Emit notifications to online users
      const io = req.app.get("io");
      if (io) {
        notifications.forEach((notification) => {
          io.to(notification.recipient._id).emit(
            "new_notification",
            notification
          );
        });
      }
    }

    // Notify the original video author
    const shareNotification = new Notification({
      recipient: {
        _id: originalVideo.author._id,
        email: originalVideo.author.email,
      },
      sender: {
        _id: author._id,
        email: author.email,
        name: author.name,
        picture: author.picture,
      },
      type: "share",
      content: `${author.name} shared your ${originalVideo.type}`,
      metadata: {
        itemId: sharedContent._id.toString(),
        originalContentId: originalVideo._id,
        itemType: "video",
        originalContentType: originalVideo.type,
      },
    });

    await shareNotification.save();

    const io = req.app.get("io");
    if (io) {
      io.to(originalVideo.author._id).emit(
        "new_notification",
        shareNotification
      );
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          sharedContent: sharedContent.toObject(),
          originalVideo,
          platform,
        },
        null,
        `${originalVideo.type} shared successfully`
      )
    );
  } catch (error) {
    console.error("Error sharing video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get video share count
const GetVideoShares = async (req, res) => {
  try {
    const { videoId } = req.params;

    const shareCount = await Content.countDocuments({
      "originalContent._id": videoId,
      isShared: true,
    });

    return res
      .status(200)
      .json(GenRes(200, { shareCount }, null, "Share count retrieved"));
  } catch (error) {
    console.error("Error getting video shares:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  ShareVideo,
  GetVideoShares,
};
