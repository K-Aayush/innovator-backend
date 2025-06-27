const MLFeedService = require("../../services/mlFeedService");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const Content = require("./contents.model");
const Like = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const NodeCache = require("node-cache");

const feedSessionCache = new NodeCache({ stdTTL: 1800 }); // 30 minutes

// Helper to track feed session
const trackFeedSession = (userId, sessionData) => {
  feedSessionCache.set(`session_${userId}`, {
    ...sessionData,
    lastActivity: new Date(),
  });
};

// Helper to determine content type
const determineContentType = (files) => {
  if (!files || !Array.isArray(files) || files.length === 0) return "text";
  const videoExtensions = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m3u8"];
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
  if (
    files.some((file) =>
      videoExtensions.some((ext) => file.toLowerCase().endsWith(ext))
    )
  ) {
    return "video";
  }
  if (
    files.some((file) =>
      imageExtensions.some((ext) => file.toLowerCase().endsWith(ext))
    )
  ) {
    return "image";
  }
  return "text";
};

// Main feed endpoint
const GetFeed = async (req, res) => {
  try {
    const {
      cursor = null,
      limit = 20,
      refresh = "false",
      quality = "medium",
    } = req.query;
    const user = req.user;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50);
    const forceRefresh = refresh === "true";

    if (cursor && !isValidObjectId(cursor)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid cursor" },
            "Invalid pagination cursor"
          )
        );
    }

    // Track session
    trackFeedSession(user._id, {
      requestTime: new Date(),
      limit: limitNum,
      refresh: forceRefresh,
      quality,
    });

    // Clear caches and seen content on refresh
    if (forceRefresh) {
      MLFeedService.clearCaches();
      MLFeedService.getSeenContent(user._id).clear();
    }

    // Fetch user profile for personalization
    const userProfile = await MLFeedService.getUserProfile(
      user._id,
      user.email
    );

    // Define filters for content
    const filters = {
      $and: [
        {
          _id: {
            $nin: Array.from(MLFeedService.getSeenContent(user._id)).map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          },
        },
        cursor ? { _id: { $lt: new mongoose.Types.ObjectId(cursor) } } : {},
      ],
    };

    // Fetch content using Content model
    const fetchLimit = limitNum * 2; // Fetch extra for splitting
    const content = await Content.find(filters)
      .sort({ createdAt: -1, views: -1 }) // Instagram-like default sort
      .limit(fetchLimit)
      .lean();

    // Categorize into video and normal content
    const videos = [];
    const normal = [];
    content.forEach((item) => {
      const contentType = determineContentType(item.files);
      item.contentType = contentType;
      if (contentType === "video") {
        videos.push(item);
      } else {
        normal.push(item);
      }
    });

    // Get engagement metrics
    const contentIds = content.map((c) => c._id.toString());
    const engagementMetrics = await MLFeedService.getEngagementMetrics(
      contentIds
    );

    // Score and optimize content
    const scoredVideos = await Promise.all(
      videos.map((item) =>
        MLFeedService.scoreAndOptimizeContent(
          item,
          userProfile,
          engagementMetrics[item._id.toString()] || {},
          quality
        )
      )
    );
    const scoredNormal = await Promise.all(
      normal.map((item) =>
        MLFeedService.scoreAndOptimizeContent(
          item,
          userProfile,
          engagementMetrics[item._id.toString()] || {},
          quality
        )
      )
    );

    // Sort by ML score and priority (Instagram-like)
    const sortedVideos = scoredVideos.sort(
      (a, b) => b.mlScore + b.priority - (a.mlScore + a.priority)
    );
    const sortedNormal = scoredNormal.sort(
      (a, b) => b.mlScore + b.priority - (a.mlScore + a.priority)
    );

    // Split into viewed and unviewed
    const seenContent = MLFeedService.getSeenContent(user._id);
    const videoArrays = {
      unviewed: sortedVideos
        .filter((item) => !seenContent.has(item._id.toString()))
        .slice(0, Math.ceil(limitNum / 2)),
      viewed: sortedVideos
        .filter((item) => seenContent.has(item._id.toString()))
        .slice(0, Math.floor(limitNum / 4)),
    };
    const normalArrays = {
      unviewed: sortedNormal
        .filter((item) => !seenContent.has(item._id.toString()))
        .slice(0, Math.ceil(limitNum / 2)),
      viewed: sortedNormal
        .filter((item) => seenContent.has(item._id.toString()))
        .slice(0, Math.floor(limitNum / 4)),
    };

    // Combine with priority to unviewed content
    const finalVideos = [...videoArrays.unviewed, ...videoArrays.viewed].slice(
      0,
      Math.ceil(limitNum / 2)
    );
    const finalNormal = [
      ...normalArrays.unviewed,
      ...normalArrays.viewed,
    ].slice(0, Math.ceil(limitNum / 2));

    // Enrich with engagement data
    const enrichedVideos = await enrichWithEngagementData(
      finalVideos,
      user.email,
      quality,
      true
    );
    const enrichedNormal = await enrichWithEngagementData(
      finalNormal,
      user.email,
      quality,
      false
    );

    // Track seen content
    const newContentIds = [...enrichedVideos, ...enrichedNormal].map((item) =>
      item._id.toString()
    );
    MLFeedService.trackSeenContent(user._id, newContentIds);

    // Randomize slightly on refresh
    if (forceRefresh) {
      const shuffle = (array) => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      };
      enrichedVideos = shuffle(
        enrichedVideos.map((item) => ({
          ...item,
          mlScore: item.mlScore + (Math.random() * 0.2 - 0.1),
        }))
      );
      enrichedNormal = shuffle(
        enrichedNormal.map((item) => ({
          ...item,
          mlScore: item.mlScore + (Math.random() * 0.2 - 0.1),
        }))
      );
    }

    // Prepare response
    const response = {
      videos: enrichedVideos.map((item, index) => ({
        ...item,
        feedPosition: index,
        loadPriority:
          item.mlScore > 0.7 ? "high" : item.mlScore > 0.4 ? "normal" : "low",
      })),
      normal: enrichedNormal.map((item, index) => ({
        ...item,
        feedPosition: index,
        loadPriority:
          item.mlScore > 0.7 ? "high" : item.mlScore > 0.4 ? "normal" : "low",
        readTime:
          item.contentType === "text" ? estimateReadTime(item.status) : null,
      })),
      hasMore: content.length >= limitNum,
      nextCursor: content.length > 0 ? content[content.length - 1]._id : null,
      algorithm: "instagram-like",
      seenContentCount: seenContent.size + newContentIds.length,
      metrics: {
        totalProcessed: contentIds.length,
        cacheHitRate: MLFeedService.calculateCacheHitRate(),
        diversityScore: MLFeedService.calculateDiversityScore([
          ...enrichedVideos,
          ...enrichedNormal,
        ]),
        responseTime: Date.now() - req.startTime,
        optimizationLevel: MLFeedService.assessOptimizationLevel(),
        videoCount: enrichedVideos.length,
        normalCount: enrichedNormal.length,
        unviewedVideos: videoArrays.unviewed.length,
        unviewedNormal: normalArrays.unviewed.length,
      },
      sessionInfo: {
        totalLoaded: enrichedVideos.length + enrichedNormal.length,
        refreshApplied: forceRefresh,
        quality,
      },
    };

    return res
      .status(200)
      .json(
        GenRes(
          200,
          response,
          null,
          `Loaded ${enrichedVideos.length} videos and ${enrichedNormal.length} normal items`
        )
      );
  } catch (error) {
    console.error("GetFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

// Enrich content with engagement data
async function enrichWithEngagementData(content, userEmail, quality, isVideo) {
  if (!content.length) return content;

  const contentIds = content.map((item) => item._id.toString());
  const [likesData, commentsData, userLikes, userComments] = await Promise.all([
    Like.aggregate([
      { $match: { uid: { $in: contentIds }, type: "content" } },
      { $group: { _id: "$uid", count: { $sum: 1 } } },
    ]),
    Comment.aggregate([
      { $match: { uid: { $in: contentIds }, type: "content" } },
      { $group: { _id: "$uid", count: { $sum: 1 } } },
    ]),
    Like.find({
      uid: { $in: contentIds },
      type: "content",
      "user.email": userEmail,
    })
      .select("uid")
      .lean(),
    Comment.find({
      uid: { $in: contentIds },
      type: "content",
      "user.email": userEmail,
    })
      .select("uid")
      .lean(),
  ]);

  const likesMap = new Map(likesData.map((item) => [item._id, item.count]));
  const commentsMap = new Map(
    commentsData.map((item) => [item._id, item.count])
  );
  const userLikesSet = new Set(userLikes.map((like) => like.uid));
  const userCommentsSet = new Set(userComments.map((comment) => comment.uid));

  return content.map((item) => {
    const enrichedItem = {
      ...item,
      likes: likesMap.get(item._id.toString()) || 0,
      comments: commentsMap.get(item._id.toString()) || 0,
      liked: userLikesSet.has(item._id.toString()),
      commented: userCommentsSet.has(item._id.toString()),
      engagementRate: calculateEngagementRate(
        likesMap.get(item._id.toString()) || 0,
        commentsMap.get(item._id.toString()) || 0,
        item.views || 0
      ),
    };

    if (isVideo) {
      return {
        ...enrichedItem,
        videoMetadata: {
          quality,
          autoplay: true,
          preload: "auto",
          muted: true,
          loop: false,
          controls: true,
        },
        thumbnailUrl: generateThumbnail(item.files?.[0]),
        hlsUrl: generateHLSUrl(item.files?.[0]),
      };
    }

    return enrichedItem;
  });
}

function calculateEngagementRate(likes, comments, views) {
  if (views === 0) return 0;
  return ((likes + comments * 2) / views) * 100;
}

function estimateReadTime(text) {
  if (!text) return 0;
  const words = text.split(" ").length;
  const wordsPerMinute = 200;
  return Math.ceil(words / wordsPerMinute);
}

function generateThumbnail(fileUrl) {
  if (!fileUrl) return null;
  const basePath = fileUrl.replace(/\.[^/.]+$/, "");
  return `${basePath}_thumbnail.jpg`;
}

function generateHLSUrl(fileUrl) {
  if (!fileUrl) return null;
  const basePath = fileUrl.replace(/\.[^/.]+$/, "");
  return `${basePath}/playlist.m3u8`;
}

module.exports = { GetFeed };
