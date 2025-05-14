const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const User = require("../user/user.model");
const Comment = require("./comments.model");
const Content = require("../contents/contents.model");
const Notification = require("../notifications/notification.model");
const { CleanUpAfterDeleteComment } = require("./comments.cleanup");

// Add Comment
const AddComment = async (req, res) => {
  try {
    const comment = req?.body?.comment;
    const type = req?.body?.type;
    const uid = req?.params?.uid;

    const noData = !uid || !type || !comment;
    const falseID = !isValidObjectId(uid);
    const inValidType = type !== "content" && type !== "course";
    const invalidContent = noData || falseID || inValidType;

    if (invalidContent) {
      const response = GenRes(400, null, {
        error: {
          message: "Invalid Data Type",
          requiredReqFormat: {
            params: "valid content's _id",
            body: {
              type: "either content or course",
              comment: "String longer than 0",
            },
          },
        },
      });
      return res.status(400).json(response);
    }

    const user = await User.findOne({
      email: req?.user?.email,
    }).select("name email picture _id");

    if (!user) {
      const response = GenRes(
        401,
        null,
        { error: "USER NOT FOUND" },
        "Fake User Token."
      );
      return res.status(401).json(response);
    }

    const content = await Content.findById(uid);
    if (!content) {
      throw new Error("Content not found!");
    }

    const newData = new Comment({
      type,
      uid,
      comment,
      user: user?.toObject(),
      edited: false,
    });

    await newData.save();

    // Create notification for content author
    const notification = new Notification({
      recipient: {
        _id: content.author._id,
        email: content.author.email,
      },
      sender: {
        _id: user._id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      type: "comment",
      content: `${user.name} commented on your ${type}`,
      metadata: {
        itemId: uid,
        itemType: type,
        commentId: newData._id.toString(),
      },
    });

    await notification.save();

    // Emit notification to online user
    const io = req.app.get("io");
    if (io) {
      io.to(content.author._id).emit("new_notification", notification);
    }

    const response = GenRes(200, newData, null, "Uploaded Successfully!");
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(
      500,
      null,
      { error: error?.toObject() },
      error?.message
    );
    return res.status(500).json(response);
  }
};

// Edit Comment
const EditComment = async (req, res) => {
  try {
    const comment = req?.body?.comment;
    const uid = req?.params?.uid;

    const noData = !uid || !comment;
    const falseID = !isValidObjectId(uid);
    const invalidContent = noData || falseID;

    if (invalidContent) {
      const response = GenRes(400, null, {
        error: {
          message: "Invalid Data Type",
          requiredReqFormat: {
            params: "valid comments's _id",
            body: {
              comment: "String longer than 0",
            },
          },
        },
      });
      return res.status(400).json(response);
    }

    const updated = await Comment.findOneAndUpdate(
      {
        _id: uid,
        "user.email": req?.user?.email,
      },
      { $set: { comment, edited: true } },
      { new: true }
    );

    if (!updated) {
      throw new Error("Could not Edit the comment!");
    }

    const response = GenRes(200, updated, null, "Updated Successfully!");
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(
      500,
      null,
      { error: error?.toObject() },
      error?.message
    );
    return res.status(500).json(response);
  }
};

const DeleteComment = async (req, res) => {
  try {
    const _id = req?.params?.uid;

    if (!_id || !isValidObjectId(_id)) {
      const response = GenRes(
        400,
        null,
        { error: "Invalid UID" },
        "UID didn't match"
      );
      return res.status(400).json(response);
    }

    const deleted = await Comment.findOneAndDelete({
      _id,
      "user.email": req?.user?.email,
    });
    if (!deleted) {
      throw new Error("Could not Delete");
    }

    CleanUpAfterDeleteComment(_id);

    const response = GenRes(200, deleted, null, "Comment Deleted");
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(
      500,
      null,
      { error: error?.toObject() },
      error?.message
    );
    return res.status(500).json(response);
  }
};

const GetComments = async (req, res) => {
  try {
    const uid = req?.query?.uid;
    const page = parseInt(req?.params?.page || "0") || 0;
    const type = req?.query?.type || "content";

    if (!uid || !isValidObjectId(uid)) {
      const response = GenRes(
        400,
        null,
        { error: "Invalid Content ID" },
        "Invlaid ID! "
      );
      return res.status(400).json(response);
    }

    const comments = await Comment.find({ uid, type })
      .skip(page * 20)
      .limit(20)
      .lean();
    if (!comments) {
      throw new Error("Comments not found!");
    }

    const response = GenRes(
      200,
      comments,
      null,
      `Responding ${comments?.length} no of comments`
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(
      500,
      null,
      { error: error?.toObject() },
      error?.message
    );
    return res.status(500).json(response);
  }
};

module.exports = { AddComment, EditComment, DeleteComment, GetComments };
