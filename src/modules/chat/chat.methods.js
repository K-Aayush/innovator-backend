const { isValidObjectId } = require("mongoose");
const ChatMessage = require("./chat.model");
const GenRes = require("../../utils/routers/GenRes");
const Follow = require("../follow/follow.model");

// Get messages between two users
const GetMessages = async (req, res) => {
  try {
    const userId = req.params.userId;
    const page = parseInt(req.query.page) || 0;
    const limit = 50;

    if (!isValidObjectId(userId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid user ID" },
            "Invalid user id provided"
          )
        );
    }

    // Check if users follow each other
    const [followA, followB] = await Promise.all([
      Follow.findOne({
        "follower.email": req.user.email,
        "following._id": userId,
      }),
      Follow.findOne({
        "follower._id": userId,
        "following.email": req.user.email,
      }),
    ]);

    if (!followA || !followB) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not mutual followers" },
            "You can only view messages with mutual followers"
          )
        );
    }

    const messages = await ChatMessage.find({
      $or: [
        {
          "sender._id": userId,
          "receiver._id": req.user._id,
          deletedByReceiver: false,
        },
        {
          "sender._id": req.user._id,
          "receiver._id": userId,
          deletedBySender: false,
        },
      ],
    })
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit);

    // Decrypt messages
    const decryptedMessages = messages.map((msg) => {
      const msgObj = msg.toObject();
      msgObj.message = msg.decryptMessage();
      return msgObj;
    });

    // Mark messages as read
    await ChatMessage.updateMany(
      {
        "sender._id": userId,
        "receiver._id": req.user._id,
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
          decryptedMessages,
          null,
          `Retrieved ${decryptedMessages.length} messages`
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get chat list with latest messages
const GetChats = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get mutual followers
    const following = await Follow.find({ "follower._id": userId }).select(
      "following"
    );
    const followers = await Follow.find({ "following._id": userId }).select(
      "follower"
    );

    const mutualEmails = following
      .map((f) => f.following.email)
      .filter((email) => followers.some((f) => f.follower.email === email));

    // Get latest chat message from each conversation
    const chats = await ChatMessage.aggregate([
      {
        $match: {
          $or: [
            {
              "sender._id": userId,
              deletedBySender: false,
              "receiver.email": { $in: mutualEmails },
            },
            {
              "receiver._id": userId,
              deletedByReceiver: false,
              "sender.email": { $in: mutualEmails },
            },
          ],
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$sender._id", userId] },
              "$receiver._id",
              "$sender._id",
            ],
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiver._id", userId] },
                    { $eq: ["$read", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    // Decrypt last messages
    const decryptedChats = chats.map((chat) => {
      const msgDoc = new ChatMessage(chat.lastMessage);
      chat.lastMessage.message = msgDoc.decryptMessage();
      return chat;
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          decryptedChats,
          null,
          `Retrieved ${decryptedChats.length} chats`
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete message for me
const DeleteMessageForMe = async (req, res) => {
  try {
    const messageId = req.params.messageId;
    const userId = req.user._id;

    if (!isValidObjectId(messageId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid message ID" },
            "Invalid message ID"
          )
        );
    }

    const message = await ChatMessage.findById(messageId);
    if (!message) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Message not found" }, "Message not found")
        );
    }

    // Update deletion flag based on user role (sender/receiver)
    const updateField =
      message.sender._id.toString() === userId.toString()
        ? { deletedBySender: true }
        : { deletedByReceiver: true };

    await ChatMessage.findByIdAndUpdate(messageId, { $set: updateField });

    return res
      .status(200)
      .json(GenRes(200, null, null, "Message deleted for you"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete message for everyone
const DeleteMessageForEveryone = async (req, res) => {
  try {
    const messageId = req.params.messageId;
    const userId = req.user._id;

    if (!isValidObjectId(messageId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid message ID" },
            "Invalid message ID"
          )
        );
    }

    const message = await ChatMessage.findById(messageId);
    if (!message) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Message not found" }, "Message not found")
        );
    }

    // Only sender can delete for everyone
    if (message.sender._id.toString() !== userId.toString()) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Unauthorized" },
            "Only sender can delete for everyone"
          )
        );
    }

    // Delete message completely
    await ChatMessage.findByIdAndUpdate(messageId, {
      $set: { deletedBySender: true, deletedByReceiver: true },
    });

    // Notify receiver through MQTT if online
    const aedes = req.app.get("aedes");
    if (aedes) {
      aedes.publish({
        topic: `user/${message.receiver._id}/deletedMessages`,
        payload: JSON.stringify({ messageId }),
      });
    }

    return res
      .status(200)
      .json(GenRes(200, null, null, "Message deleted for everyone"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete entire conversation for me
const DeleteConversation = async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    const userId = req.user._id;

    if (!isValidObjectId(otherUserId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid user ID" }, "Invalid user ID")
        );
    }

    // Update all messages in the conversation
    await ChatMessage.updateMany(
      {
        $or: [
          { "sender._id": userId, "receiver._id": otherUserId },
          { "sender._id": otherUserId, "receiver._id": userId },
        ],
      },
      {
        $set: {
          deletedBySender: {
            $cond: [{ $eq: ["$sender._id", userId] }, true, "$deletedBySender"],
          },
          deletedByReceiver: {
            $cond: [
              { $eq: ["$receiver._id", userId] },
              true,
              "$deletedByReceiver",
            ],
          },
        },
      }
    );

    return res
      .status(200)
      .json(GenRes(200, null, null, "Conversation deleted"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  GetMessages,
  GetChats,
  DeleteMessageForMe,
  DeleteMessageForEveryone,
  DeleteConversation,
};
