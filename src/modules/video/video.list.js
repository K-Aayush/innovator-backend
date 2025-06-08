const Video = require("./video.model");
const Follow = require("../follow/follow.model");
const Likes = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const GenRes = require("../../utils/routers/GenRes");
const NodeCache = require("node-cache");

// Initialize cache with 5 minutes TTL
const videoCache = new NodeCache({ stdTTL: 300 });

// Helper function to shuffle array
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// Enrich videos with additional data
const enrichVideos = async (videos, userEmail) => {
  return Promise.all(
    videos.map(async (video) => {
      const [likes, comments] = await Promise.all([
        Likes.countDocuments({ uid: video._id, type: "video" }),
        Comment.countDocuments({ uid: video._id, type: "video" }),
      ]);

      const liked = await Likes.findOne({
        uid: video._id,
        type: "video",
        "user.email": userEmail,
      });

      return {
        ...video,
        likes,
        comments,
        liked: !!liked,
      };
    })
  );
};

// List Videos (longer content)
const ListVideos = async (req, res) => {
  try {
    const { search, category, lastId, pageSize = 10 } = req.query;
    const user = req.user;
    const pageSizeNum = parseInt(pageSize, 10) || 10;

    const filters = {
      type: "video",
      isPublic: true,
      processingStatus: "completed",
    };

    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { "author.name": { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    if (category && category !== "all") {
      filters.category = category;
    }

    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Get user's following list for personalized content
    const following = await Follow.find({ "follower.email": user.email });
    const followingEmails = following.map((f) => f.following.email);

    // Fetch videos with preference for followed users
    let videos = await Video.find(filters)
      .sort({
        "author.email": { $in: followingEmails } ? -1 : 1,
        createdAt: -1,
      })
      .limit(pageSizeNum + 1)
      .lean();

    const hasMore = videos.length > pageSizeNum;
    const results = hasMore ? videos.slice(0, -1) : videos;

    // Shuffle results for variety
    const shuffledVideos = shuffleArray([...results]);

    const enrichedVideos = await enrichVideos(shuffledVideos, user.email);

    return res.status(200).json(
      GenRes(
        200,
        {
          videos: enrichedVideos,
          hasMore,
          nextCursor: hasMore ? results[results.length - 1]?._id || null : null,
        },
        null,
        `Retrieved ${enrichedVideos.length} videos`
      )
    );
  } catch (err) {
    console.error("ListVideos error:", err.message);
    return res.status(500).json(GenRes(500, null, err, err?.message));
  }
};

// List Reels (short content)
const ListReels = async (req, res) => {
  try {
    const { lastId, pageSize = 20 } = req.query;
    const user = req.user;
    const pageSizeNum = parseInt(pageSize, 10) || 20;

    const filters = {
      type: "reel",
      isPublic: true,
      processingStatus: "completed",
    };

    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Get user's following list for personalized content
    const following = await Follow.find({ "follower.email": user.email });
    const followingEmails = following.map((f) => f.following.email);

    // Fetch reels with preference for followed users and recent content
    let reels = await Video.find(filters)
      .sort({
        "author.email": { $in: followingEmails } ? -1 : 1,
        createdAt: -1,
      })
      .limit(pageSizeNum + 1)
      .lean();

    const hasMore = reels.length > pageSizeNum;
    const results = hasMore ? reels.slice(0, -1) : reels;

    // Shuffle for discovery
    const shuffledReels = shuffleArray([...results]);

    const enrichedReels = await enrichVideos(shuffledReels, user.email);

    return res.status(200).json(
      GenRes(
        200,
        {
          reels: enrichedReels,
          hasMore,
          nextCursor: hasMore ? results[results.length - 1]?._id || null : null,
        },
        null,
        `Retrieved ${enrichedReels.length} reels`
      )
    );
  } catch (err) {
    console.error("ListReels error:", err.message);
    return res.status(500).json(GenRes(500, null, err, err?.message));
  }
};

// Get single video/reel
const GetVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const video = await Video.findById(id).lean();
    if (!video) {
      return res.status(404).json(GenRes(404, null, null, "Video not found"));
    }

    const enrichedVideo = await enrichVideos([video], user.email);

    return res
      .status(200)
      .json(
        GenRes(200, enrichedVideo[0], null, "Video retrieved successfully")
      );
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

    const filters = { "author._id": userId };
    if (type && ["video", "reel"].includes(type)) {
      filters.type = type;
    }

    const videos = await Video.find(filters)
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(parseInt(limit))
      .lean();

    const enrichedVideos = await enrichVideos(videos, user.email);

    return res
      .status(200)
      .json(
        GenRes(200, enrichedVideos, null, "User videos retrieved successfully")
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
