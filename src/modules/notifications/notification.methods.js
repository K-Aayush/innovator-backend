const Video = require("../video/video.model");
const User = require("../user/user.model");
const Follow = require("../follow/follow.model");
const Like = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

// Helper function to shuffle array
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// List videos (longer content)
const ListVideos = async (req, res) => {
  try {
    const { search, category, lastId, pageSize = 10 } = req.query;
    const user = req.user;
    const pageSizeNum = parseInt(pageSize, 10) || 10;

    const filters = { type: "video", isPublic: true };

    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { "author.name": { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    if (category) {
      filters.category = category;
    }

    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Get user's following list for personalized feed
    const following = await Follow.find({ "follower.email": user.email });
    const followingEmails = following.map((f) => f.following.email);

    // Fetch videos with preference for followed users
    let videos = await Video.find(filters)
      .sort({ _id: -1 })
      .limit(pageSizeNum * 2)
      .lean();

    // Prioritize videos from followed users
    const followedVideos = videos.filter((video) =>
      followingEmails.includes(video.author.email)
    );
    const otherVideos = videos.filter(
      (video) => !followingEmails.includes(video.author.email)
    );

    // Mix followed and other videos
    const mixedVideos = [
      ...followedVideos.slice(0, Math.ceil(pageSizeNum / 2)),
      ...shuffleArray(otherVideos).slice(0, Math.floor(pageSizeNum / 2)),
    ].slice(0, pageSizeNum);

    // Enrich videos with engagement data
    const enrichedVideos = await Promise.all(
      mixedVideos.map(async (video) => {
        const [likes, comments] = await Promise.all([
          Like.countDocuments({ uid: video._id, type: "video" }),
          Comment.countDocuments({ uid: video._id, type: "video" }),
        ]);

        const liked = await Like.findOne({
          uid: video._id,
          type: "video",
          "user.email": user.email,
        });

        return {
          ...video,
          likes,
          comments,
          liked: !!liked,
        };
      })
    );

    const hasMore = videos.length > pageSizeNum;

    return res.status(200).json(
      GenRes(
        200,
        {
          videos: enrichedVideos,
          hasMore,
          nextCursor: hasMore
            ? enrichedVideos[enrichedVideos.length - 1]?._id || null
            : null,
        },
        null,
        `Retrieved ${enrichedVideos.length} videos`
      )
    );
  } catch (error) {
    console.error("ListVideos error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// List reels (short content)
const ListReels = async (req, res) => {
  try {
    const { search, category, lastId, pageSize = 20 } = req.query;
    const user = req.user;
    const pageSizeNum = parseInt(pageSize, 10) || 20;

    const filters = { type: "reel", isPublic: true };

    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { "author.name": { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    if (category) {
      filters.category = category;
    }

    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Get user's following list for personalized feed
    const following = await Follow.find({ "follower.email": user.email });
    const followingEmails = following.map((f) => f.following.email);

    // Fetch reels with preference for followed users
    let reels = await Video.find(filters)
      .sort({ _id: -1 })
      .limit(pageSizeNum * 2)
      .lean();

    // Prioritize reels from followed users
    const followedReels = reels.filter((reel) =>
      followingEmails.includes(reel.author.email)
    );
    const otherReels = reels.filter(
      (reel) => !followingEmails.includes(reel.author.email)
    );

    // Mix followed and other reels, shuffle for variety
    const mixedReels = shuffleArray([
      ...followedReels.slice(0, Math.ceil(pageSizeNum / 2)),
      ...otherReels.slice(0, Math.floor(pageSizeNum / 2)),
    ]).slice(0, pageSizeNum);

    // Enrich reels with engagement data
    const enrichedReels = await Promise.all(
      mixedReels.map(async (reel) => {
        const [likes, comments] = await Promise.all([
          Like.countDocuments({ uid: reel._id, type: "video" }),
          Comment.countDocuments({ uid: reel._id, type: "video" }),
        ]);

        const liked = await Like.findOne({
          uid: reel._id,
          type: "video",
          "user.email": user.email,
        });

        return {
          ...reel,
          likes,
          comments,
          liked: !!liked,
        };
      })
    );

    const hasMore = reels.length > pageSizeNum;

    return res.status(200).json(
      GenRes(
        200,
        {
          reels: enrichedReels,
          hasMore,
          nextCursor: hasMore
            ? enrichedReels[enrichedReels.length - 1]?._id || null
            : null,
        },
        null,
        `Retrieved ${enrichedReels.length} reels`
      )
    );
  } catch (error) {
    console.error("ListReels error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get single video/reel
const GetVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid video ID" }, "Invalid video ID")
        );
    }

    const video = await Video.findById(id).lean();
    if (!video) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Video not found" }, "Video not found")
        );
    }

    // Get engagement data
    const [likes, comments] = await Promise.all([
      Like.countDocuments({ uid: video._id, type: "video" }),
      Comment.countDocuments({ uid: video._id, type: "video" }),
    ]);

    const liked = await Like.findOne({
      uid: video._id,
      type: "video",
      "user.email": user.email,
    });

    const enrichedVideo = {
      ...video,
      likes,
      comments,
      liked: !!liked,
    };

    return res
      .status(200)
      .json(GenRes(200, enrichedVideo, null, "Video retrieved successfully"));
  } catch (error) {
    console.error("GetVideo error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's videos
const GetUserVideos = async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, page = 0, limit = 10 } = req.query;
    const user = req.user;

    if (!isValidObjectId(userId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid user ID" }, "Invalid user ID")
        );
    }

    const targetUser = await User.findById(userId).select("name email picture");
    if (!targetUser) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "User not found" }, "User not found"));
    }

    const filters = { "author._id": userId, isPublic: true };
    if (type && ["video", "reel"].includes(type)) {
      filters.type = type;
    }

    const pageNum = parseInt(page, 10) || 0;
    const limitNum = parseInt(limit, 10) || 10;

    const [videos, totalCount] = await Promise.all([
      Video.find(filters)
        .sort({ createdAt: -1 })
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      Video.countDocuments(filters),
    ]);

    // Enrich videos with engagement data
    const enrichedVideos = await Promise.all(
      videos.map(async (video) => {
        const [likes, comments] = await Promise.all([
          Like.countDocuments({ uid: video._id, type: "video" }),
          Comment.countDocuments({ uid: video._id, type: "video" }),
        ]);

        const liked = await Like.findOne({
          uid: video._id,
          type: "video",
          "user.email": user.email,
        });

        return {
          ...video,
          likes,
          comments,
          liked: !!liked,
        };
      })
    );

    return res.status(200).json(
      GenRes(
        200,
        {
          user: {
            _id: targetUser._id,
            name: targetUser.name,
            email: targetUser.email,
            picture: targetUser.picture,
          },
          videos: enrichedVideos,
          pagination: {
            page: pageNum,
            totalPages: Math.ceil(totalCount / limitNum),
            totalVideos: totalCount,
            hasMore: (pageNum + 1) * limitNum < totalCount,
          },
        },
        null,
        "User videos retrieved successfully"
      )
    );
  } catch (error) {
    console.error("GetUserVideos error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  ListVideos,
  ListReels,
  GetVideo,
  GetUserVideos,
};
