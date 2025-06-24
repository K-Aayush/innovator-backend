const MLFeedService = require("../../services/mlFeedService");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

// Get personalized ML-powered feed (content only - including videos)
const GetPersonalizedFeed = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 50,
      lastContentId,
      quality = "medium",
      contentType = "all", // 'all', 'text', 'video', 'image'
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

    const options = {
      page: pageNum,
      limit: limitNum,
      lastContentId,
      quality,
      contentType,
    };

    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      options
    );

    return res
      .status(200)
      .json(
        GenRes(
          200,
          result.data,
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

    const options = {
      page: pageNum,
      limit: limitNum,
      lastContentId,
      quality,
      contentType: "video", // Only video content
    };

    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      options
    );

    return res.status(200).json(
      GenRes(
        200,
        {
          videos: result.data.feed,
          hasMore: result.data.hasMore,
          nextCursor: result.data.nextCursor,
          mlMetrics: result.data.mlMetrics,
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

// Get content-only feed (no videos)
const GetContentFeed = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 30,
      lastContentId,
      quality = "medium",
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

    const options = {
      page: pageNum,
      limit: limitNum,
      lastContentId,
      quality,
      contentType: "text", // Only text/image content (no videos)
    };

    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      options
    );

    return res.status(200).json(
      GenRes(
        200,
        {
          content: result.data.feed,
          hasMore: result.data.hasMore,
          nextCursor: result.data.nextCursor,
          mlMetrics: result.data.mlMetrics,
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
    } = req.query;

    const user = req.user;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 30);

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

    return res.status(200).json(
      GenRes(
        200,
        {
          trending: trendingItems,
          timeframe,
          totalItems: trendingItems.length,
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

// Refresh feed (clear cache and regenerate)
const RefreshFeed = async (req, res) => {
  try {
    const user = req.user;

    // Clear user-specific caches
    MLFeedService.clearCaches();

    // Generate fresh feed
    const result = await MLFeedService.generatePersonalizedFeed(
      user._id,
      user.email,
      { limit: 50, quality: "medium" }
    );

    return res
      .status(200)
      .json(GenRes(200, result.data, null, "Feed refreshed successfully"));
  } catch (error) {
    console.error("RefreshFeed error:", error);
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
      },
      systemMetrics: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
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
};
