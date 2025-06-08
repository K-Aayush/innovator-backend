const path = require("path");
const GenRes = require("../../utils/routers/GenRes");
const User = require("../user/user.model");
const Video = require("./video.model");
const Notification = require("../notifications/notification.model");
const Follow = require("../follow/follow.model");
const fs = require("fs");

const AddVideo = async (req, res) => {
  try {
    const data = req?.body;
    const user = req?.user;
    const videoFile = req?.file_locations?.video;
    const thumbnailFile = req?.file_locations?.thumbnail;

    if (!videoFile) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Video file required" },
            "Video file required"
          )
        );
    }

    // Find author
    const author = await User.findOne({ ...user })
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

    // Validate video type and duration
    const duration = parseInt(data.duration) || 0;
    let videoType = data.type || "video";

    // Auto-determine type based on duration if not specified
    if (!data.type) {
      videoType = duration <= 60 ? "reel" : "video";
    }

    // Validate duration constraints
    if (videoType === "reel" && duration > 60) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Reels must be 60 seconds or less" },
            "Invalid reel duration"
          )
        );
    }

    const videoData = {
      title: data.title,
      description: data.description,
      videoUrl: videoFile,
      thumbnail: thumbnailFile || "",
      duration,
      type: videoType,
      tags: Array.isArray(data.tags) ? data.tags : [],
      category: data.category || "general",
      author: author,
      quality: data.quality || "720p",
      fileSize: data.fileSize || 0,
      aspectRatio: data.aspectRatio || (videoType === "reel" ? "9:16" : "16:9"),
      isPublic: data.isPublic !== false,
      processingStatus: "completed",
    };

    const newVideo = new Video(videoData);
    await newVideo.save();

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
      type: videoType,
      content: `${author.name} uploaded a new ${videoType}: ${data.title}`,
      metadata: {
        itemId: newVideo._id.toString(),
        itemType: videoType,
        videoTitle: data.title,
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

    return res
      .status(200)
      .json(
        GenRes(
          200,
          newVideo.toObject(),
          null,
          `${videoType} uploaded successfully`
        )
      );
  } catch (error) {
    console.error("Error in AddVideo:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const UpdateVideo = async (req, res) => {
  try {
    const data = req?.body;
    const _id = req?.params?.id;
    const userEmail = req?.user?.email;

    delete data?._id;
    delete data?.author;
    delete data?.videoUrl; 

    const updated = await Video.findOneAndUpdate(
      { _id, "author.email": userEmail },
      { $set: { ...data } },
      { new: true }
    );

    if (!updated) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Video not found" },
            "Video not found or unauthorized"
          )
        );
    }

    return res
      .status(200)
      .json(GenRes(200, updated, null, "Video updated successfully"));
  } catch (error) {
    console.error("Error updating video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const DeleteVideo = async (req, res) => {
  try {
    const _id = req?.params?.id;
    const deletedVideo = await Video.findOneAndDelete({
      _id,
      "author.email": req?.user?.email,
    });

    if (!deletedVideo) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Video not found" },
            "Video not found or unauthorized"
          )
        );
    }

    // Delete video file
    if (deletedVideo.videoUrl) {
      try {
        const fullpath = path.join(
          process.cwd(),
          deletedVideo.videoUrl.slice(1)
        );
        fs.unlinkSync(fullpath);
      } catch (err) {
        console.log("Failed to delete video file:", err?.message);
      }
    }

    // Delete thumbnail if exists
    if (deletedVideo.thumbnail) {
      try {
        const fullpath = path.join(
          process.cwd(),
          deletedVideo.thumbnail.slice(1)
        );
        fs.unlinkSync(fullpath);
      } catch (err) {
        console.log("Failed to delete thumbnail:", err?.message);
      }
    }

    return res
      .status(200)
      .json(GenRes(200, null, null, "Video deleted successfully"));
  } catch (error) {
    console.error("Error deleting video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const IncrementVideoView = async (req, res) => {
  try {
    const { id: videoId } = req.params;
    const userEmail = req.user.email;

    if (!videoId) {
      return res.status(400).json(GenRes(400, null, null, "Invalid video ID"));
    }

    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json(GenRes(404, null, null, "Video not found"));
    }

    // Update view count and viewedBy
    const result = await Video.updateOne(
      { _id: videoId },
      { $inc: { views: 1 }, $addToSet: { viewedBy: userEmail } }
    );

    return res
      .status(200)
      .json(GenRes(200, { success: true }, null, "View incremented"));
  } catch (err) {
    console.error("IncrementVideoView error:", err.message);
    return res.status(500).json(GenRes(500, null, err, err.message));
  }
};

module.exports = {
  AddVideo,
  UpdateVideo,
  DeleteVideo,
  IncrementVideoView,
};
