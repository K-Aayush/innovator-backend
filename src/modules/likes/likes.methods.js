const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const Like = require("./likes.model");
const User = require("../user/user.model");
const Content = require("../contents/contents.model");
const Notification = require("../notifications/notification.model");

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

    for (const data of body) {
      const { uid, type } = data;

      if (
        !uid ||
        !isValidObjectId(uid) ||
        !type ||
        (type !== "content" && type !== "course")
      ) {
        const response = GenRes(
          400,
          null,
          { error: "INVALID DATA TYPE" },
          "Invalid data. 'type' must be 'content' or 'course', and valid 'uid' required!"
        );
        return res.status(400).json(response);
      }

      const contentExist = await Content.findById(uid);
      if (!contentExist) {
        throw new Error("This content no longer exists!");
      }

      const deleted = await Like.findOneAndDelete({
        uid,
        "user.email": userEmail,
      });

      if (!deleted) {
        const newLike = new Like({
          type,
          uid,
          user: getUser.toObject(),
        });
        await newLike.save();

        // Create notification for content author
        const notification = new Notification({
          recipient: {
            _id: contentExist.author._id,
            email: contentExist.author.email,
          },
          sender: {
            _id: getUser._id,
            email: getUser.email,
            name: getUser.name,
            picture: getUser.picture,
          },
          type: "like",
          content: `${getUser.name} liked your ${type}`,
          metadata: {
            itemId: uid,
            itemType: type,
          },
        });

        await notification.save();

        // Emit notification to online user
        const io = req.app.get("io");
        if (io) {
          io.to(contentExist.author._id).emit("new_notification", notification);
        }
      }
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

module.exports = LikeHandler;
