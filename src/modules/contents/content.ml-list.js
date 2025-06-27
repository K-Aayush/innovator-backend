const MLFeedService = require("../../services/mlFeedService");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const Like = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const Content = require("./contents.model");
const User = require("../user/user.model");
const NodeCache = require("node-cache");

// Enhanced cache for tracking user interactions and seen content
const userInteractionCache = new NodeCache({ stdTTL: 7200 }); // 2 hours
const seenContentCache = new NodeCache({ stdTTL: 86400 }); // 24 hours
const feedSessionCache = new NodeCache({ stdTTL: 1800 }); // 30 minutes

// Helper functions for Instagram-like behavior
const trackSeenContent = (userId, contentIds) => {
  const key = `seen_${userId}`;
  const existing = seenContentCache.get(key) || new Set();
  contentIds.forEach((id) => existing.add(id.toString()));
  seenContentCache.set(key, existing);
  return existing;
};

const getSeenContent = (userId) => {
  const key = `seen_${userId}`;
  return seenContentCache.get(key) || new Set();
};

const clearSeenContent = (userId) => {
  const key = `seen_${userId}`;
  seenContentCache.del(key);
};

const trackFeedSession = (userId, sessionData) => {
  const key = `session_${userId}`;
  feedSessionCache.set(key, {
    ...sessionData,
    lastActivity: new Date(),
    feedType: sessionData.feedType || "mixed",
  });
};

// Instagram-like main feed with infinite scroll
const GetInstagramFeed = async (req, res) => {
  try {
    const {
      cursor = null,
      limit = 20,
      contentType = "all", // 'all', 'video', 'text', 'image'
      excludeIds = "",
      quality = "medium",
      sessionId = null,
    } = req.query;

    const user = req.user;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50); // Max 50 items

    // Validate cursor
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

    // Parse excluded IDs
    const excludedIds = excludeIds
      ? excludeIds.split(",").filter((id) => isValidObjectId(id))
      : [];

    // Get user's seen content
    const seenContent = getSeenContent(user._id);
    const allExcludedIds = [...excludedIds, ...Array.from(seenContent)];

    // Track feed session
    trackFeedSession(user._id, {
      feedType: contentType,
      sessionId,
      requestTime: new Date(),
      limit: limitNum,
    });

    // Generate Instagram-like feed
    const result = await MLFeedService.generateInstagramFeed(
      user._id,
      user.email,
      {
        cursor,
        limit: limitNum,
        contentType,
        excludeIds: allExcludedIds,
        forceRefresh: false,
      }
    );

    if (!result.success || !result.data.feed.length) {
      return res.status(200).json(
        GenRes(
          200,
          {
            feed: [],
            hasMore: false,
            nextCursor: null,
            algorithm: "instagram-like",
            seenContentCount: seenContent.size,
          },
          null,
          "No more content available"
        )
      );
    }

    // Enrich with real-time engagement data
    const enrichedFeed = await enrichWithEngagementData(
      result.data.feed,
      user.email
    );

    // Track newly seen content
    const newContentIds = enrichedFeed.map((item) => item._id.toString());
    trackSeenContent(user._id, newContentIds);

    // Add Instagram-like metadata
    const response = {
      feed: enrichedFeed.map((item) => ({
        ...item,
        // Add Instagram-like properties
        isSponsored: false, // For future ad integration
        saveCount: 0, // For future save feature
        shareCount: 0, // For future share feature
        algorithm: item.algorithm || "instagram-like",
        feedPosition: enrichedFeed.indexOf(item),
        loadPriority: item.loadPriority || "normal",
      })),
      hasMore: result.data.hasMore,
      nextCursor: result.data.nextCursor,
      algorithm: "instagram-like",
      seenContentCount: seenContent.size + newContentIds.length,
      metrics: result.data.metrics,
      sessionInfo: {
        contentType,
        totalLoaded: enrichedFeed.length,
        newContent: newContentIds.length,
      },
    };

    return res
      .status(200)
      .json(
        GenRes(
          200,
          response,
          null,
          `Loaded ${enrichedFeed.length} items with Instagram algorithm`
        )
      );
  } catch (error) {
    console.error("GetInstagramFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Video feed with TikTok/Instagram Reels-like algorithm
const GetVideoFeed = async (req, res) => {
  try {
    const {
      cursor = null,
      limit = 15, // Smaller limit for videos
      quality = "medium",
      excludeIds = "",
      autoplay = "true",
    } = req.query;

    const user = req.user;
    const limitNum = Math.min(parseInt(limit, 10) || 15, 30);

    if (cursor && !isValidObjectId(cursor)) {
      return res
        .status(400)
        .json(GenRes(400, null, { error: "Invalid cursor" }, "Invalid cursor"));
    }

    const excludedIds = excludeIds
      ? excludeIds.split(",").filter((id) => isValidObjectId(id))
      : [];

    const seenContent = getSeenContent(user._id);
    const allExcludedIds = [...excludedIds, ...Array.from(seenContent)];

    // Generate video-optimized feed
    const result = await MLFeedService.generateInstagramFeed(
      user._id,
      user.email,
      {
        cursor,
        limit: limitNum,
        contentType: "video",
        excludeIds: allExcludedIds,
        forceRefresh: false,
      }
    );

    if (!result.success || !result.data.feed.length) {
      return res.status(200).json(
        GenRes(
          200,
          {
            videos: [],
            hasMore: false,
            nextCursor: null,
            algorithm: "video-optimized",
          },
          null,
          "No more videos available"
        )
      );
    }

    // Enrich videos with additional metadata
    const enrichedVideos = await enrichVideosWithMetadata(
      result.data.feed,
      user.email,
      quality,
      autoplay === "true"
    );

    const newContentIds = enrichedVideos.map((item) => item._id.toString());
    trackSeenContent(user._id, newContentIds);

    const response = {
      videos: enrichedVideos,
      hasMore: result.data.hasMore,
      nextCursor: result.data.nextCursor,
      algorithm: "video-optimized",
      autoplayEnabled: autoplay === "true",
      seenContentCount: seenContent.size + newContentIds.length,
      metrics: result.data.metrics,
    };

    return res
      .status(200)
      .json(
        GenRes(200, response, null, `Loaded ${enrichedVideos.length} videos`)
      );
  } catch (error) {
    console.error("GetVideoFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Content feed (text/image only, no videos)
const GetContentFeed = async (req, res) => {
  try {
    const {
      cursor = null,
      limit = 25,
      quality = "medium",
      excludeIds = "",
      includeImages = "true",
    } = req.query;

    const user = req.user;
    const limitNum = Math.min(parseInt(limit, 10) || 25, 40);

    if (cursor && !isValidObjectId(cursor)) {
      return res
        .status(400)
        .json(GenRes(400, null, { error: "Invalid cursor" }, "Invalid cursor"));
    }

    const excludedIds = excludeIds
      ? excludeIds.split(",").filter((id) => isValidObjectId(id))
      : [];

    const seenContent = getSeenContent(user._id);
    const allExcludedIds = [...excludedIds, ...Array.from(seenContent)];

    // Determine content type filter
    const contentType = includeImages === "true" ? "text" : "text-only";

    const result = await MLFeedService.generateInstagramFeed(
      user._id,
      user.email,
      {
        cursor,
        limit: limitNum,
        contentType: "text", // This excludes videos
        excludeIds: allExcludedIds,
        forceRefresh: false,
      }
    );

    if (!result.success || !result.data.feed.length) {
      return res.status(200).json(
        GenRes(
          200,
          {
            content: [],
            hasMore: false,
            nextCursor: null,
            algorithm: "content-optimized",
          },
          null,
          "No more content available"
        )
      );
    }

    const enrichedContent = await enrichWithEngagementData(
      result.data.feed,
      user.email
    );

    const newContentIds = enrichedContent.map((item) => item._id.toString());
    trackSeenContent(user._id, newContentIds);

    const response = {
      content: enrichedContent.map((item) => ({
        ...item,
        readTime: estimateReadTime(item.status),
        wordCount: item.status ? item.status.split(" ").length : 0,
      })),
      hasMore: result.data.hasMore,
      nextCursor: result.data.nextCursor,
      algorithm: "content-optimized",
      includeImages: includeImages === "true",
      seenContentCount: seenContent.size + newContentIds.length,
      metrics: result.data.metrics,
    };

    return res
      .status(200)
      .json(
        GenRes(
          200,
          response,
          null,
          `Loaded ${enrichedContent.length} content items`
        )
      );
  } catch (error) {
    console.error("GetContentFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Enhanced refresh with Instagram-like new content strategy
const RefreshFeed = async (req, res) => {
  try {
    const { contentType = "all", limit = 30, clearSeen = "false" } = req.body;

    const user = req.user;
    const limitNum = Math.min(parseInt(limit) || 30, 50);

    // Clear seen content if requested (like "pull to refresh")
    if (clearSeen === "true") {
      clearSeenContent(user._id);
    }

    // Clear relevant caches for fresh content
    MLFeedService.clearAllCaches();

    // Generate completely fresh feed with refresh strategy
    const result = await MLFeedService.refreshFeedStrategy(
      user._id,
      user.email,
      contentType
    );

    if (!result.success) {
      return res
        .status(500)
        .json(
          GenRes(
            500,
            null,
            { error: "Refresh failed" },
            "Could not refresh feed"
          )
        );
    }

    // Enrich the refreshed content
    const enrichedFeed = await enrichWithEngagementData(
      result.data.feed.slice(0, limitNum),
      user.email
    );

    // Track new content as seen
    const newContentIds = enrichedFeed.map((item) => item._id.toString());
    trackSeenContent(user._id, newContentIds);

    // Update session info
    trackFeedSession(user._id, {
      feedType: contentType,
      refreshed: true,
      refreshTime: new Date(),
      newContentCount: enrichedFeed.length,
    });

    const response = {
      feed: enrichedFeed.map((item) => ({
        ...item,
        isRefreshed: true,
        refreshPriority: item.mlScore > 0.7 ? "high" : "normal",
      })),
      hasMore: result.data.hasMore,
      nextCursor: result.data.nextCursor,
      refreshed: true,
      refreshStrategy: "instagram-like",
      newContentCount: enrichedFeed.length,
      clearedSeen: clearSeen === "true",
      metrics: result.data.metrics,
    };

    return res
      .status(200)
      .json(
        GenRes(
          200,
          response,
          null,
          `Feed refreshed with ${enrichedFeed.length} new items`
        )
      );
  } catch (error) {
    console.error("RefreshFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Trending feed with time-based filtering
const GetTrendingFeed = async (req, res) => {
  try {
    const {
      timeframe = "24h", // "1h", "6h", "24h", "7d"
      limit = 20,
      contentType = "all",
      cursor = null,
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

    // Get trending content with enhanced algorithm
    const trendingContent = await getTrendingContent(
      since,
      limitNum * 2,
      contentType,
      cursor
    );

    // Score and sort trending content
    const scoredContent = await Promise.all(
      trendingContent.map(async (content) => {
        const engagement = await getContentEngagement(content._id);
        const trendingScore = calculateTrendingScore(
          content,
          engagement,
          hours
        );

        return {
          ...content,
          trendingScore,
          engagement,
          timeframe,
        };
      })
    );

    // Sort by trending score and take top items
    const topTrending = scoredContent
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, limitNum);

    // Enrich with user interaction data
    const enrichedTrending = await enrichWithEngagementData(
      topTrending,
      user.email
    );

    const response = {
      trending: enrichedTrending.map((item) => ({
        ...item,
        isTrending: true,
        trendingRank: enrichedTrending.indexOf(item) + 1,
      })),
      timeframe,
      hasMore: scoredContent.length > limitNum,
      nextCursor:
        topTrending.length > 0 ? topTrending[topTrending.length - 1]._id : null,
      algorithm: "trending-optimized",
      totalTrending: scoredContent.length,
    };

    return res
      .status(200)
      .json(
        GenRes(
          200,
          response,
          null,
          `Found ${enrichedTrending.length} trending items`
        )
      );
  } catch (error) {
    console.error("GetTrendingFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Clear seen content (Instagram-like "clear history")
const ClearSeenContent = async (req, res) => {
  try {
    const user = req.user;
    clearSeenContent(user._id);

    return res
      .status(200)
      .json(
        GenRes(200, { cleared: true }, null, "Seen content history cleared")
      );
  } catch (error) {
    console.error("ClearSeenContent error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's feed analytics and seen content stats
const GetFeedAnalytics = async (req, res) => {
  try {
    const user = req.user;
    const seenContent = getSeenContent(user._id);
    const sessionInfo = feedSessionCache.get(`session_${user._id}`);

    const analytics = {
      user: {
        seenContentCount: seenContent.size,
        currentSession: sessionInfo,
        feedPreferences: await getUserFeedPreferences(user._id, user.email),
      },
      performance: MLFeedService.getPerformanceMetrics(),
      algorithm: {
        version: "instagram-like-v2",
        lastOptimization: new Date(),
        cacheEfficiency: calculateCacheEfficiency(),
      },
    };

    // Admin-only detailed analytics
    if (user.role === "admin") {
      analytics.system = {
        totalUsers: userInteractionCache.keys().length,
        cacheStats: {
          userInteraction: userInteractionCache.getStats(),
          seenContent: seenContentCache.getStats(),
          feedSession: feedSessionCache.getStats(),
        },
        memoryUsage: process.memoryUsage(),
      };
    }

    return res
      .status(200)
      .json(GenRes(200, analytics, null, "Feed analytics retrieved"));
  } catch (error) {
    console.error("GetFeedAnalytics error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Helper functions
async function enrichWithEngagementData(content, userEmail) {
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

  return content.map((item) => ({
    ...item,
    likes: likesMap.get(item._id.toString()) || 0,
    comments: commentsMap.get(item._id.toString()) || 0,
    liked: userLikesSet.has(item._id.toString()),
    commented: userCommentsSet.has(item._id.toString()),
    engagementLoaded: true,
    engagementRate: calculateEngagementRate(
      likesMap.get(item._id.toString()) || 0,
      commentsMap.get(item._id.toString()) || 0,
      item.views || 0
    ),
  }));
}

async function enrichVideosWithMetadata(videos, userEmail, quality, autoplay) {
  const enriched = await enrichWithEngagementData(videos, userEmail);

  return enriched.map((video) => ({
    ...video,
    videoMetadata: {
      quality,
      autoplay,
      preload: autoplay ? "auto" : "metadata",
      muted: autoplay, // Autoplay videos should be muted
      loop: false,
      controls: true,
    },
    thumbnailUrl: generateThumbnail(video.files?.[0]),
    hlsUrl: generateHLSUrl(video.files?.[0]),
    estimatedDuration: estimateVideoDuration(video.files?.[0]),
  }));
}

async function getTrendingContent(since, limit, contentType, cursor) {
  const filters = {
    createdAt: { $gte: since },
  };

  if (cursor) {
    filters._id = { $lt: cursor };
  }

  if (contentType === "video") {
    filters.files = {
      $elemMatch: {
        $regex: /\.(mp4|mov|webm|avi|mkv|m3u8)$/i,
      },
    };
  } else if (contentType === "text") {
    filters.$or = [
      { files: { $exists: false } },
      { files: { $size: 0 } },
      {
        files: {
          $not: {
            $elemMatch: {
              $regex: /\.(mp4|mov|webm|avi|mkv|m3u8)$/i,
            },
          },
        },
      },
    ];
  }

  return await Content.find(filters)
    .sort({ views: -1, createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getContentEngagement(contentId) {
  const [likes, comments, content] = await Promise.all([
    Like.countDocuments({ uid: contentId, type: "content" }),
    Comment.countDocuments({ uid: contentId, type: "content" }),
    Content.findById(contentId).select("views viewedBy").lean(),
  ]);

  return {
    likes,
    comments,
    views: content?.views || 0,
    viewedBy: content?.viewedBy?.length || 0,
  };
}

function calculateTrendingScore(content, engagement, timeframeHours) {
  const ageInHours =
    (Date.now() - new Date(content.createdAt)) / (1000 * 60 * 60);
  const recencyFactor = Math.max(0, 1 - ageInHours / timeframeHours);

  const engagementScore =
    (engagement.likes || 0) * 1 +
    (engagement.comments || 0) * 4 +
    (engagement.views || 0) * 0.1;

  const viralFactor =
    engagement.views > 0
      ? (engagement.likes + engagement.comments * 3) / engagement.views
      : 0;

  return engagementScore * recencyFactor * (1 + viralFactor * 10);
}

function calculateEngagementRate(likes, comments, views) {
  if (views === 0) return 0;
  return ((likes + comments * 2) / views) * 100;
}

function estimateReadTime(text) {
  if (!text) return 0;
  const words = text.split(" ").length;
  const wordsPerMinute = 200; // Average reading speed
  return Math.ceil(words / wordsPerMinute);
}

function generateThumbnail(videoUrl) {
  if (!videoUrl) return null;
  const basePath = videoUrl.replace(/\.[^/.]+$/, "");
  return `${basePath}_thumbnail.jpg`;
}

function generateHLSUrl(videoUrl) {
  if (!videoUrl) return null;
  const basePath = videoUrl.replace(/\.[^/.]+$/, "");
  return `${basePath}/playlist.m3u8`;
}

function estimateVideoDuration(videoUrl) {
  // Placeholder - in real implementation, you'd extract from metadata
  return Math.floor(Math.random() * 180) + 30; // 30-210 seconds
}

function calculateCacheEfficiency() {
  const caches = [userInteractionCache, seenContentCache, feedSessionCache];
  let totalHits = 0;
  let totalRequests = 0;

  caches.forEach((cache) => {
    const stats = cache.getStats();
    totalHits += stats.hits || 0;
    totalRequests += (stats.hits || 0) + (stats.misses || 0);
  });

  return totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;
}

async function getUserFeedPreferences(userId, userEmail) {
  // Analyze user's recent activity to determine preferences
  const [recentLikes, userProfile] = await Promise.all([
    Like.find({ "user.email": userEmail })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("uid", "type files")
      .lean(),
    User.findById(userId).select("profession education role createdAt").lean(),
  ]);

  const contentTypes = { text: 0, image: 0, video: 0 };

  recentLikes.forEach((like) => {
    if (like.uid && like.uid.files) {
      const hasVideo = like.uid.files.some((file) =>
        /\.(mp4|mov|webm|avi|mkv|m3u8)$/i.test(file)
      );
      const hasImage = like.uid.files.some((file) =>
        /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(file)
      );

      if (hasVideo) contentTypes.video++;
      else if (hasImage) contentTypes.image++;
      else contentTypes.text++;
    } else {
      contentTypes.text++;
    }
  });

  const total = Object.values(contentTypes).reduce((a, b) => a + b, 0);

  // Calculate user persona
  let persona = "casual";
  if (userProfile?.role === "vendor") persona = "business";
  else if (userProfile?.profession) {
    const prof = userProfile.profession.toLowerCase();
    if (prof.includes("artist") || prof.includes("designer"))
      persona = "creative";
    else if (prof.includes("engineer") || prof.includes("developer"))
      persona = "professional";
    else if (prof.includes("student")) persona = "student";
  }

  // Calculate account age
  const accountAge = userProfile?.createdAt
    ? (Date.now() - new Date(userProfile.createdAt)) / (1000 * 60 * 60 * 24)
    : 0;

  return {
    preferredContentTypes:
      total > 0
        ? {
            text: ((contentTypes.text / total) * 100).toFixed(1),
            image: ((contentTypes.image / total) * 100).toFixed(1),
            video: ((contentTypes.video / total) * 100).toFixed(1),
          }
        : { text: 33.3, image: 33.3, video: 33.3 },

    engagementLevel: total > 20 ? "high" : total > 10 ? "medium" : "low",
    lastActivity: recentLikes[0]?.createdAt || null,

    // Enhanced preferences based on User model
    userPersona: persona,
    accountMaturity:
      accountAge < 30
        ? "new"
        : accountAge < 90
        ? "recent"
        : accountAge < 365
        ? "established"
        : "veteran",

    professionalInterests: userProfile?.profession || userProfile?.role || null,
    educationalBackground: userProfile?.education || null,

    // Algorithm preferences based on persona
    algorithmWeights: {
      engagement:
        persona === "creative" ? 0.4 : persona === "business" ? 0.3 : 0.35,
      recency: persona === "student" ? 0.3 : 0.25,
      discovery: persona === "business" ? 0.1 : 0.15,
      quality: persona === "professional" ? 0.2 : 0.1,
    },
  };
}

// Get user's seen content stats
const GetSeenContentStats = async (req, res) => {
  try {
    const user = req.user;
    const seenContent = getSeenContent(user._id);
    const sessionInfo = feedSessionCache.get(`session_${user._id}`);

    // Get additional user analytics
    const userPrefs = await getUserFeedPreferences(user._id, user.email);

    return res.status(200).json(
      GenRes(
        200,
        {
          seenContentCount: seenContent.size,
          seenContentIds: Array.from(seenContent).slice(0, 100),
          currentSession: sessionInfo,
          userPreferences: userPrefs,
          cacheInfo: {
            seenContentTTL: 86400, // 24 hours
            sessionTTL: 1800, // 30 minutes
          },
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

// Get personalized recommendations based on user profile
const GetPersonalizedRecommendations = async (req, res) => {
  try {
    const user = req.user;
    const { type = "mixed", limit = 10 } = req.query;

    // Get user profile for personalization
    const userProfile = await User.findById(user._id)
      .select("profession education role interests location")
      .lean();

    // Generate recommendations based on user's profile
    const recommendations = await generateUserBasedRecommendations(
      user._id,
      user.email,
      userProfile,
      type,
      parseInt(limit)
    );

    return res.status(200).json(
      GenRes(
        200,
        {
          recommendations,
          basedOn: {
            profession: userProfile?.profession,
            education: userProfile?.education,
            role: userProfile?.role,
            location: userProfile?.location,
          },
          algorithm: "user-profile-based",
        },
        null,
        `Generated ${recommendations.length} personalized recommendations`
      )
    );
  } catch (error) {
    console.error("GetPersonalizedRecommendations error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Generate recommendations based on user profile
async function generateUserBasedRecommendations(
  userId,
  userEmail,
  userProfile,
  type,
  limit
) {
  const recommendations = [];

  // Content type recommendations based on profession
  if (userProfile?.profession) {
    const prof = userProfile.profession.toLowerCase();
    let contentFilter = {};

    if (prof.includes("artist") || prof.includes("designer")) {
      contentFilter = { type: { $in: ["innovation", "idea", "share"] } };
    } else if (prof.includes("engineer") || prof.includes("developer")) {
      contentFilter = { type: { $in: ["innovation", "project"] } };
    } else if (prof.includes("business") || prof.includes("entrepreneur")) {
      contentFilter = { type: { $in: ["announcement", "share", "project"] } };
    }

    const profContent = await Content.find(contentFilter)
      .sort({ views: -1, createdAt: -1 })
      .limit(Math.ceil(limit * 0.4))
      .lean();

    recommendations.push(...profContent);
  }

  // Location-based recommendations
  if (userProfile?.location) {
    const locationContent = await Content.find({
      $or: [
        { "author.location": { $regex: userProfile.location, $options: "i" } },
        { status: { $regex: userProfile.location, $options: "i" } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(Math.ceil(limit * 0.3))
      .lean();

    recommendations.push(...locationContent);
  }

  // Role-based recommendations
  if (userProfile?.role === "vendor") {
    const businessContent = await Content.find({
      $or: [
        { type: "announcement" },
        { status: { $regex: /(business|marketing|sales|entrepreneur)/i } },
      ],
    })
      .sort({ views: -1 })
      .limit(Math.ceil(limit * 0.3))
      .lean();

    recommendations.push(...businessContent);
  }

  // Remove duplicates and limit results
  const uniqueRecommendations = recommendations
    .filter(
      (item, index, arr) =>
        arr.findIndex((t) => t._id.toString() === item._id.toString()) === index
    )
    .slice(0, limit);

  return uniqueRecommendations;
}

module.exports = {
  GetInstagramFeed,
  GetVideoFeed,
  GetContentFeed,
  RefreshFeed,
  GetTrendingFeed,
  GetFeedAnalytics,
  ClearSeenContent,
  GetSeenContentStats,
  GetPersonalizedRecommendations,

  // Legacy compatibility - map old endpoints to new Instagram-like feeds
  GetPersonalizedFeed: GetInstagramFeed,
};
