const MLFeedService = require("../../services/mlFeedService");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const Like = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const Content = require("./contents.model");
const NodeCache = require("node-cache");

// Cache for tracking user's seen content to prevent duplicates
const userSeenContentCache = new NodeCache({ stdTTL: 3600 }); // 1 hour

// Helper function to track seen content
const trackSeenContent = (userId, contentIds) => {
  const key = `seen_${userId}`;
  const existing = userSeenContentCache.get(key) || new Set();
  contentIds.forEach((id) => existing.add(id.toString()));
  userSeenContentCache.set(key, existing);
  return existing;
};

// Helper function to get seen content
const getSeenContent = (userId) => {
  const key = `seen_${userId}`;
  return userSeenContentCache.get(key) || new Set();
};

// Helper function to clear seen content (for refresh)
const clearSeenContent = (userId) => {
  const key = `seen_${userId}`;
  userSeenContentCache.del(key);
};

// Get personalized ML-powered feed (content only - including videos)
const GetPersonalizedFeed = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 50,
      lastContentId,
      quality = "medium",
      contentType = "all", // 'all', 'text', 'video', 'image'
      excludeIds = "", // Comma-separated list of content IDs to exclude
    } = req.query;

    const user = req.user;
    const pageNum = parseInt(page, 10) || 0;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 50); // Max 50 items

    // Validate cursor ID if provided
    if (lastContentId && !isValidObjectId(lastContentId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid lastContentId" },
            "Invalid cursor"
          )
        );
    }

    // Parse excluded IDs
    const excludedIds = excludeIds
      ? excludeIds.split(",").filter((id) => isValidObjectId(id))
      : [];

    // Get user's seen content to prevent duplicates
    const seenContent = getSeenContent(user._id);
    const allExcludedIds = [...excludedIds, ...Array.from(seenContent)];

    const options = {
      page: pageNum,
      limit: limitNum,
      lastContentId,
      quality,
      contentType,
      excludeIds: allExcludedIds,
      userId: user._id,
    };

    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      options
    );

    // Enrich with engagement data
    const contentIds = result.data.feed.map((item) => item._id.toString());

    if (contentIds.length > 0) {
      const [likesData, commentsData, userLikes] = await Promise.all([
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
          "user.email": user.email,
        })
          .select("uid")
          .lean(),
      ]);

      const likesMap = new Map(likesData.map((item) => [item._id, item.count]));
      const commentsMap = new Map(
        commentsData.map((item) => [item._id, item.count])
      );
      const userLikesSet = new Set(userLikes.map((like) => like.uid));

      // Update feed items with engagement data
      result.data.feed = result.data.feed.map((item) => ({
        ...item,
        likes: likesMap.get(item._id.toString()) || 0,
        comments: commentsMap.get(item._id.toString()) || 0,
        liked: userLikesSet.has(item._id.toString()),
        engagementLoaded: true,
      }));

      // Track seen content
      trackSeenContent(user._id, contentIds);
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          ...result.data,
          seenContentCount: seenContent.size,
          excludedCount: allExcludedIds.length,
        },
        null,
        `Generated personalized feed with ${result.data.feed.length} items`
      )
    );
  } catch (error) {
    console.error("GetPersonalizedFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get video-only feed (from content model)
const GetVideoFeed = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 20,
      lastContentId,
      quality = "medium",
      excludeIds = "",
    } = req.query;

    const user = req.user;
    const pageNum = parseInt(page, 10) || 0;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 30); // Max 30 videos

    if (lastContentId && !isValidObjectId(lastContentId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid lastContentId" },
            "Invalid cursor"
          )
        );
    }

    // Parse excluded IDs and get seen content
    const excludedIds = excludeIds
      ? excludeIds.split(",").filter((id) => isValidObjectId(id))
      : [];
    const seenContent = getSeenContent(user._id);
    const allExcludedIds = [...excludedIds, ...Array.from(seenContent)];

    const options = {
      page: pageNum,
      limit: limitNum,
      lastContentId,
      quality,
      contentType: "video", // Only video content
      excludeIds: allExcludedIds,
      userId: user._id,
    };

    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      options
    );

    // Enrich with engagement data
    const contentIds = result.data.feed.map((item) => item._id.toString());

    if (contentIds.length > 0) {
      const [likesData, commentsData, userLikes] = await Promise.all([
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
          "user.email": user.email,
        })
          .select("uid")
          .lean(),
      ]);

      const likesMap = new Map(likesData.map((item) => [item._id, item.count]));
      const commentsMap = new Map(
        commentsData.map((item) => [item._id, item.count])
      );
      const userLikesSet = new Set(userLikes.map((like) => like.uid));

      result.data.feed = result.data.feed.map((item) => ({
        ...item,
        likes: likesMap.get(item._id.toString()) || 0,
        comments: commentsMap.get(item._id.toString()) || 0,
        liked: userLikesSet.has(item._id.toString()),
        engagementLoaded: true,
      }));

      // Track seen content
      trackSeenContent(user._id, contentIds);
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          videos: result.data.feed,
          hasMore: result.data.hasMore,
          nextCursor: result.data.nextCursor,
          mlMetrics: result.data.mlMetrics,
          seenContentCount: seenContent.size,
        },
        null,
        `Generated video feed with ${result.data.feed.length} videos`
      )
    );
  } catch (error) {
    console.error("GetVideoFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get content-only feed (no videos) - FIXED TO EXCLUDE VIDEOS
const GetContentFeed = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 30,
      lastContentId,
      quality = "medium",
      excludeIds = "",
    } = req.query;

    const user = req.user;
    const pageNum = parseInt(page, 10) || 0;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 40);

    if (lastContentId && !isValidObjectId(lastContentId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid lastContentId" },
            "Invalid cursor"
          )
        );
    }

    // Parse excluded IDs and get seen content
    const excludedIds = excludeIds
      ? excludeIds.split(",").filter((id) => isValidObjectId(id))
      : [];
    const seenContent = getSeenContent(user._id);
    const allExcludedIds = [...excludedIds, ...Array.from(seenContent)];

    const options = {
      page: pageNum,
      limit: limitNum,
      lastContentId,
      quality,
      contentType: "text", // Only text/image content (no videos)
      excludeIds: allExcludedIds,
      userId: user._id,
    };

    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      options
    );

    // Enrich with engagement data
    const contentIds = result.data.feed.map((item) => item._id.toString());

    if (contentIds.length > 0) {
      const [likesData, commentsData, userLikes] = await Promise.all([
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
          "user.email": user.email,
        })
          .select("uid")
          .lean(),
      ]);

      const likesMap = new Map(likesData.map((item) => [item._id, item.count]));
      const commentsMap = new Map(
        commentsData.map((item) => [item._id, item.count])
      );
      const userLikesSet = new Set(userLikes.map((like) => like.uid));

      result.data.feed = result.data.feed.map((item) => ({
        ...item,
        likes: likesMap.get(item._id.toString()) || 0,
        comments: commentsMap.get(item._id.toString()) || 0,
        liked: userLikesSet.has(item._id.toString()),
        engagementLoaded: true,
      }));

      // Track seen content
      trackSeenContent(user._id, contentIds);
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          content: result.data.feed,
          hasMore: result.data.hasMore,
          nextCursor: result.data.nextCursor,
          mlMetrics: result.data.mlMetrics,
          seenContentCount: seenContent.size,
        },
        null,
        `Generated content feed with ${result.data.feed.length} items`
      )
    );
  } catch (error) {
    console.error("GetContentFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get trending content (high engagement)
const GetTrendingFeed = async (req, res) => {
  try {
    const {
      timeframe = "24h",
      limit = 20,
      type = "all", // 'all', 'text', 'video'
      excludeIds = "",
      lastContentId,
    } = req.query;

    const user = req.user;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 30);

    // Parse excluded IDs and get seen content
    const excludedIds = excludeIds
      ? excludeIds.split(",").filter((id) => isValidObjectId(id))
      : [];
    const seenContent = getSeenContent(user._id);
    const allExcludedIds = [...excludedIds, ...Array.from(seenContent)];

    // Calculate timeframe
    const timeframeHours = {
      "1h": 1,
      "6h": 6,
      "24h": 24,
      "7d": 168,
    };

    const hours = timeframeHours[timeframe] || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const options = {
      page: 0,
      limit: limitNum * 2, // Fetch more for trending calculation
      quality: "high",
      contentType: type,
      trending: true,
      since,
      excludeIds: allExcludedIds,
      lastContentId,
      userId: user._id,
    };

    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      options
    );

    // Filter and sort by engagement for trending
    const trendingItems = result.data.feed
      .filter((item) => new Date(item.createdAt) >= since)
      .sort((a, b) => {
        const scoreA =
          (a.likes || 0) * 1 + (a.comments || 0) * 3 + (a.views || 0) * 0.1;
        const scoreB =
          (b.likes || 0) * 1 + (b.comments || 0) * 3 + (b.views || 0) * 0.1;
        return scoreB - scoreA;
      })
      .slice(0, limitNum);

    // Enrich with engagement data
    const contentIds = trendingItems.map((item) => item._id.toString());

    if (contentIds.length > 0) {
      const [likesData, commentsData, userLikes] = await Promise.all([
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
          "user.email": user.email,
        })
          .select("uid")
          .lean(),
      ]);

      const likesMap = new Map(likesData.map((item) => [item._id, item.count]));
      const commentsMap = new Map(
        commentsData.map((item) => [item._id, item.count])
      );
      const userLikesSet = new Set(userLikes.map((like) => like.uid));

      trendingItems.forEach((item) => {
        item.likes = likesMap.get(item._id.toString()) || 0;
        item.comments = commentsMap.get(item._id.toString()) || 0;
        item.liked = userLikesSet.has(item._id.toString());
        item.engagementLoaded = true;
      });

      // Track seen content
      trackSeenContent(user._id, contentIds);
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          trending: trendingItems,
          timeframe,
          totalItems: trendingItems.length,
          hasMore: trendingItems.length >= limitNum,
          nextCursor:
            trendingItems.length > 0
              ? trendingItems[trendingItems.length - 1]._id
              : null,
          seenContentCount: seenContent.size,
        },
        null,
        `Generated trending feed for ${timeframe}`
      )
    );
  } catch (error) {
    console.error("GetTrendingFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Refresh feed (clear cache and regenerate with different strategy)
const RefreshFeed = async (req, res) => {
  try {
    const user = req.user;
    const { contentType = "all", limit = 50 } = req.body;

    // Clear user-specific caches and seen content
    MLFeedService.clearCaches();
    clearSeenContent(user._id);

    // Use different sorting strategies for refresh to ensure variety
    const refreshStrategies = [
      { sort: { createdAt: -1 }, strategy: "recent" },
      { sort: { views: -1, createdAt: -1 }, strategy: "popular" },
      { sort: { _id: 1 }, strategy: "random" }, // Ascending ID for different order
    ];

    // Randomly select a strategy
    const selectedStrategy =
      refreshStrategies[Math.floor(Math.random() * refreshStrategies.length)];

    // Generate fresh feed with different strategy
    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      {
        limit: parseInt(limit) || 50,
        quality: "medium",
        contentType,
        refreshStrategy: selectedStrategy,
        forceRefresh: true,
        userId: user._id,
      }
    );

    // Enrich with engagement data
    const contentIds = result.data.feed.map((item) => item._id.toString());

    if (contentIds.length > 0) {
      const [likesData, commentsData, userLikes] = await Promise.all([
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
          "user.email": user.email,
        })
          .select("uid")
          .lean(),
      ]);

      const likesMap = new Map(likesData.map((item) => [item._id, item.count]));
      const commentsMap = new Map(
        commentsData.map((item) => [item._id, item.count])
      );
      const userLikesSet = new Set(userLikes.map((like) => like.uid));

      result.data.feed = result.data.feed.map((item) => ({
        ...item,
        likes: likesMap.get(item._id.toString()) || 0,
        comments: commentsMap.get(item._id.toString()) || 0,
        liked: userLikesSet.has(item._id.toString()),
        engagementLoaded: true,
      }));

      // Track new seen content
      trackSeenContent(user._id, contentIds);
    }

    return res.status(200).json(
      GenRes(
        200,
        {
          ...result.data,
          refreshStrategy: selectedStrategy.strategy,
          refreshedAt: new Date(),
        },
        null,
        `Feed refreshed successfully with ${selectedStrategy.strategy} strategy`
      )
    );
  } catch (error) {
    console.error("RefreshFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Clear user's seen content history
const ClearSeenContent = async (req, res) => {
  try {
    const user = req.user;
    clearSeenContent(user._id);

    return res
      .status(200)
      .json(GenRes(200, null, null, "Seen content history cleared"));
  } catch (error) {
    console.error("ClearSeenContent error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's seen content stats
const GetSeenContentStats = async (req, res) => {
  try {
    const user = req.user;
    const seenContent = getSeenContent(user._id);

    return res.status(200).json(
      GenRes(
        200,
        {
          seenContentCount: seenContent.size,
          seenContentIds: Array.from(seenContent).slice(0, 100), // Return first 100 for debugging
        },
        null,
        "Seen content stats retrieved"
      )
    );
  } catch (error) {
    console.error("GetSeenContentStats error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get feed analytics (for debugging/admin)
const GetFeedAnalytics = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(403, null, { error: "Admin access required" }, "Forbidden")
        );
    }

    const analytics = {
      cacheStats: {
        feedCache: MLFeedService.feedCache?.getStats() || {},
        userProfileCache: MLFeedService.userProfileCache?.getStats() || {},
        engagementCache: MLFeedService.engagementCache?.getStats() || {},
        mlScoreCache: MLFeedService.mlScoreCache?.getStats() || {},
        seenContentCache: userSeenContentCache.getStats(),
      },
      systemMetrics: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
      },
      userSeenContentStats: {
        totalUsers: userSeenContentCache.keys().length,
        averageSeenContent:
          userSeenContentCache.keys().reduce((acc, key) => {
            const seenContent = userSeenContentCache.get(key);
            return acc + (seenContent ? seenContent.size : 0);
          }, 0) / Math.max(userSeenContentCache.keys().length, 1),
      },
    };

    return res
      .status(200)
      .json(GenRes(200, analytics, null, "Feed analytics retrieved"));
  } catch (error) {
    console.error("GetFeedAnalytics error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  GetPersonalizedFeed,
  GetVideoFeed,
  GetContentFeed,
  GetTrendingFeed,
  RefreshFeed,
  GetFeedAnalytics,
  ClearSeenContent,
  GetSeenContentStats,
};
