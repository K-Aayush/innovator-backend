const Block = require("./block.model");
const User = require("./user.model");
const Follow = require("../follow/follow.model");
const ChatMessage = require("../chat/chat.model");
const Content = require("../contents/contents.model");
const Notification = require("../notifications/notification.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

// Block a user
const BlockUser = async (req, res) => {
  try {
    const { userId, reason, blockType = "full" } = req.body;
    const blockerId = req.user._id;
    const blockerEmail = req.user.email;

    if (!userId || !isValidObjectId(userId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Valid user ID required" },
            "Invalid user ID"
          )
        );
    }

    if (userId === blockerId) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Cannot block yourself" },
            "Cannot block yourself"
          )
        );
    }

    // Get user details
    const [blocker, blocked] = await Promise.all([
      User.findById(blockerId).select("_id email name picture").lean(),
      User.findById(userId).select("_id email name picture").lean(),
    ]);

    if (!blocked) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "User not found" }, "User not found"));
    }

    // Check if already blocked
    const existingBlock = await Block.findOne({
      "blocker._id": blockerId,
      "blocked._id": userId,
    });

    if (existingBlock) {
      return res
        .status(409)
        .json(
          GenRes(
            409,
            null,
            { error: "User already blocked" },
            "User is already blocked"
          )
        );
    }

    // Gather interaction history before blocking
    const [followRelation, mutualFollows, hadConversations, sharedContent] =
      await Promise.all([
        Follow.findOne({
          $or: [
            { "follower._id": blockerId, "following._id": userId },
            { "follower._id": userId, "following._id": blockerId },
          ],
        }),
        Follow.find({
          $or: [{ "follower._id": blockerId }, { "following._id": blockerId }],
        }).select("follower following"),
        ChatMessage.findOne({
          $or: [
            { "sender._id": blockerId, "receiver._id": userId },
            { "sender._id": userId, "receiver._id": blockerId },
          ],
        }),
        Content.findOne({
          $or: [
            { "author._id": blockerId, "originalContent.author._id": userId },
            { "author._id": userId, "originalContent.author._id": blockerId },
          ],
        }),
      ]);

    // Create block record
    const blockData = {
      blocker: blocker,
      blocked: blocked,
      reason: reason || "No reason provided",
      blockType,
      previousInteractions: {
        followedEachOther: !!followRelation,
        hadConversations: !!hadConversations,
        sharedContent: !!sharedContent,
      },
    };

    const newBlock = new Block(blockData);
    await newBlock.save();

    // Remove follow relationships
    await Follow.deleteMany({
      $or: [
        { "follower._id": blockerId, "following._id": userId },
        { "follower._id": userId, "following._id": blockerId },
      ],
    });

    // Mark chat messages as deleted for both users
    await ChatMessage.updateMany(
      {
        $or: [
          { "sender._id": blockerId, "receiver._id": userId },
          { "sender._id": userId, "receiver._id": blockerId },
        ],
      },
      {
        $set: {
          deletedBySender: true,
          deletedByReceiver: true,
        },
      }
    );

    // Remove notifications between users
    await Notification.deleteMany({
      $or: [
        { "sender._id": blockerId, "recipient._id": userId },
        { "sender._id": userId, "recipient._id": blockerId },
      ],
    });

    // Emit real-time block notification
    const io = req.app.get("io");
    if (io) {
      io.to(userId).emit("user_blocked", {
        type: "blocked_by_user",
        blockerId,
        blockerName: blocker.name,
        timestamp: new Date(),
      });
    }

    return res
      .status(200)
      .json(GenRes(200, newBlock, null, "User blocked successfully"));
  } catch (error) {
    console.error("Error blocking user:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Unblock a user
const UnblockUser = async (req, res) => {
  try {
    const { userId } = req.body;
    const blockerId = req.user._id;

    if (!userId || !isValidObjectId(userId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Valid user ID required" },
            "Invalid user ID"
          )
        );
    }

    const block = await Block.findOneAndDelete({
      "blocker._id": blockerId,
      "blocked._id": userId,
    });

    if (!block) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Block not found" }, "User is not blocked")
        );
    }

    // Emit real-time unblock notification
    const io = req.app.get("io");
    if (io) {
      io.to(userId).emit("user_unblocked", {
        type: "unblocked_by_user",
        blockerId,
        timestamp: new Date(),
      });
    }

    return res
      .status(200)
      .json(GenRes(200, block, null, "User unblocked successfully"));
  } catch (error) {
    console.error("Error unblocking user:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get blocked users list
const GetBlockedUsers = async (req, res) => {
  try {
    const blockerId = req.user._id;
    const page = parseInt(req.query.page) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const [blocks, total] = await Promise.all([
      Block.find({ "blocker._id": blockerId })
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .lean(),
      Block.countDocuments({ "blocker._id": blockerId }),
    ]);

    const blockedUsers = blocks.map((block) => ({
      ...block.blocked,
      blockReason: block.reason,
      blockType: block.blockType,
      blockedAt: block.createdAt,
      previousInteractions: block.previousInteractions,
    }));

    return res.status(200).json(
      GenRes(
        200,
        {
          blockedUsers,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
            hasMore: (page + 1) * limit < total,
          },
        },
        null,
        `Retrieved ${blockedUsers.length} blocked users`
      )
    );
  } catch (error) {
    console.error("Error getting blocked users:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Check if user is blocked
const CheckBlockStatus = async (req, res) => {
  try {
    const { userId } = req.query;
    const currentUserId = req.user._id;

    if (!userId || !isValidObjectId(userId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Valid user ID required" },
            "Invalid user ID"
          )
        );
    }

    const [blockedByMe, blockedByThem] = await Promise.all([
      Block.findOne({
        "blocker._id": currentUserId,
        "blocked._id": userId,
      }).lean(),
      Block.findOne({
        "blocker._id": userId,
        "blocked._id": currentUserId,
      }).lean(),
    ]);

    return res.status(200).json(
      GenRes(
        200,
        {
          isBlockedByMe: !!blockedByMe,
          isBlockedByThem: !!blockedByThem,
          canInteract: !blockedByMe && !blockedByThem,
          blockDetails: {
            byMe: blockedByMe
              ? {
                  reason: blockedByMe.reason,
                  blockType: blockedByMe.blockType,
                  blockedAt: blockedByMe.createdAt,
                }
              : null,
            byThem: blockedByThem
              ? {
                  blockedAt: blockedByThem.createdAt,
                }
              : null,
          },
        },
        null,
        "Block status retrieved"
      )
    );
  } catch (error) {
    console.error("Error checking block status:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get users who blocked me
const GetUsersWhoBlockedMe = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const [blocks, total] = await Promise.all([
      Block.find({ "blocked._id": userId })
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .select("blocker createdAt blockType")
        .lean(),
      Block.countDocuments({ "blocked._id": userId }),
    ]);

    const blockers = blocks.map((block) => ({
      ...block.blocker,
      blockType: block.blockType,
      blockedAt: block.createdAt,
    }));

    return res.status(200).json(
      GenRes(
        200,
        {
          blockers,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
            hasMore: (page + 1) * limit < total,
          },
        },
        null,
        `Retrieved ${blockers.length} users who blocked you`
      )
    );
  } catch (error) {
    console.error("Error getting users who blocked me:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Middleware to check if users can interact
const checkBlockStatus = async (req, res, next) => {
  try {
    const currentUserId = req.user?._id;
    const targetUserId =
      req.params.userId || req.body.userId || req.query.userId;

    if (!currentUserId || !targetUserId) {
      return next();
    }

    const block = await Block.findOne({
      $or: [
        { "blocker._id": currentUserId, "blocked._id": targetUserId },
        { "blocker._id": targetUserId, "blocked._id": currentUserId },
      ],
    }).lean();

    if (block) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Users cannot interact" },
            "One user has blocked the other"
          )
        );
    }

    next();
  } catch (error) {
    console.error("Error in block status middleware:", error);
    next();
  }
};

module.exports = {
  BlockUser,
  UnblockUser,
  GetBlockedUsers,
  CheckBlockStatus,
  GetUsersWhoBlockedMe,
  checkBlockStatus,
};
