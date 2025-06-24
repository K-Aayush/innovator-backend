const User = require("../modules/user/user.model");
const Content = require("../modules/contents/contents.model");
const Follow = require("../modules/follow/follow.model");
const Like = require("../modules/likes/likes.model");
const Comment = require("../modules/comments/comments.model");
const NodeCache = require("node-cache");

// Import optimization components
const ContentRanking = require("../utils/algorithms/contentRanking");
const FeedOptimizer = require("../utils/performance/feedOptimizer");

// Enhanced caching with different TTLs
const feedCache = new NodeCache({ stdTTL: 300 }); // 5 minutes
const userProfileCache = new NodeCache({ stdTTL: 600 }); // 10 minutes
const engagementCache = new NodeCache({ stdTTL: 180 }); // 3 minutes
const mlScoreCache = new NodeCache({ stdTTL: 900 }); // 15 minutes

class MLFeedService {
  constructor() {
    this.contentWeights = {
      recency: 0.25,
      engagement: 0.3,
      relationship: 0.25,
      userPreference: 0.2,
    };

    this.engagementWeights = {
      like: 1,
      comment: 3,
      share: 5,
      view: 0.1,
    };

    // Performance monitoring
    this.performanceMetrics = {
      totalRequests: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      lastOptimization: new Date(),
      mlCalculations: 0,
      optimizationEvents: 0,
    };

    // Integration with optimization components
    this.contentRanking = ContentRanking;
    this.feedOptimizer = FeedOptimizer;
  }

  // Helper function to check if content has video files
  hasVideoFiles(files) {
    if (!files || !Array.isArray(files)) return false;
    const videoExtensions = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m3u8"];
    return files.some((file) =>
      videoExtensions.some((ext) => file.toLowerCase().endsWith(ext))
    );
  }

  // Helper function to check if content has image files
  hasImageFiles(files) {
    if (!files || !Array.isArray(files)) return false;
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
    return files.some((file) =>
      imageExtensions.some((ext) => file.toLowerCase().endsWith(ext))
    );
  }

  // Generate HLS playlist URL for videos
  generateHLSUrl(videoUrl) {
    if (!videoUrl) return null;
    const basePath = videoUrl.replace(/\.[^/.]+$/, "");
    return `${basePath}/playlist.m3u8`;
  }

  // Generate thumbnail URL
  generateThumbnailUrl(fileUrl) {
    if (!fileUrl) return null;
    const basePath = fileUrl.replace(/\.[^/.]+$/, "");
    const pathParts = basePath.split("/");
    pathParts.splice(-1, 0, "thumbnails");
    return `${pathParts.join("/")}_thumb.jpg`;
  }

  // Optimized file URL generation with HLS support
  optimizeFileUrls(files, quality = "auto") {
    if (!files || files.length === 0) return [];

    return files.map((file) => {
      const isVideo = this.hasVideoFiles([file]);
      const isImage = this.hasImageFiles([file]);

      if (isVideo) {
        const hlsUrl = this.generateHLSUrl(file);
        const thumbnailUrl = this.generateThumbnailUrl(file);

        // Return different qualities based on request
        const qualities = {
          low: {
            url: thumbnailUrl, // Just thumbnail for low quality
            type: "image",
            isVideoThumbnail: true,
          },
          medium: {
            url: hlsUrl || file,
            type: "video",
            format: "hls",
            qualities: ["360p", "480p"],
          },
          high: {
            url: hlsUrl || file,
            type: "video",
            format: "hls",
            qualities: ["480p", "720p", "1080p"],
          },
          auto: {
            url: hlsUrl || file,
            type: "video",
            format: "hls",
            qualities: ["360p", "480p", "720p"],
          },
        };

        return {
          ...(qualities[quality] || qualities.auto),
          thumbnail: thumbnailUrl,
          original: file,
          hls: hlsUrl,
          fileSize: "streaming", // Indicate streaming content
        };
      } else if (isImage) {
        const thumbnailUrl = this.generateThumbnailUrl(file);

        const qualities = {
          low: {
            url: thumbnailUrl,
            width: 300,
            height: 200,
          },
          medium: {
            url: thumbnailUrl,
            width: 600,
            height: 400,
          },
          high: {
            url: file,
            width: "original",
            height: "original",
          },
          auto: {
            url: thumbnailUrl,
            width: 400,
            height: 300,
          },
        };

        return {
          ...(qualities[quality] || qualities.auto),
          type: "image",
          original: file,
          thumbnail: thumbnailUrl,
        };
      }

      return {
        url: file,
        original: file,
        type: "other",
      };
    });
  }

  // Get comprehensive user profile for ML with optimization
  async getUserProfile(userId, userEmail) {
    const cacheKey = `user_profile_${userId}`;

    // Try optimized cache first
    let cached = this.feedOptimizer.getFromCache(cacheKey);
    if (cached) return cached;

    // Fallback to basic cache
    cached = userProfileCache.get(cacheKey);
    if (cached) return cached;

    const [user, following, followers, recentLikes, recentComments] =
      await Promise.all([
        User.findById(userId).select("interests level createdAt").lean(),
        Follow.find({ "follower._id": userId })
          .select("following")
          .limit(200)
          .lean(),
        Follow.find({ "following._id": userId })
          .select("follower")
          .limit(200)
          .lean(),
        Like.find({ "user.email": userEmail })
          .sort({ createdAt: -1 })
          .limit(100)
          .select("uid type createdAt")
          .lean(),
        Comment.find({ "user.email": userEmail })
          .sort({ createdAt: -1 })
          .limit(50)
          .select("uid type createdAt")
          .lean(),
      ]);

    const profile = {
      user,
      followingEmails: following.map((f) => f.following.email),
      followingIds: following.map((f) => f.following._id),
      followerCount: followers.length,
      followingCount: following.length,
      recentLikes: recentLikes.map((l) => l.uid),
      recentComments: recentComments.map((c) => c.uid),
      engagementPattern: this.analyzeEngagementPattern(
        recentLikes,
        recentComments
      ),
      accountAge: user?.createdAt
        ? Date.now() - new Date(user.createdAt).getTime()
        : 0,
      previousInteractions: this.buildInteractionMap(
        recentLikes,
        recentComments
      ),
      preferredContentTypes: this.extractContentTypePreferences(
        recentLikes,
        recentComments
      ),
      activeHours: this.calculateActiveHours(recentLikes, recentComments),
      recentlySeenAuthors: this.extractRecentAuthors(
        recentLikes,
        recentComments
      ),
      recentlySeenTypes: this.extractRecentTypes(recentLikes, recentComments),
    };

    // Cache with optimization
    await this.feedOptimizer.cacheContent(cacheKey, profile, {
      popularity: "warm",
      priority: "high",
    });
    userProfileCache.set(cacheKey, profile);

    return profile;
  }

  // Build interaction map for advanced ranking
  buildInteractionMap(likes, comments) {
    const interactions = {};

    [...likes, ...comments].forEach((activity) => {
      interactions[activity.uid] = (interactions[activity.uid] || 0) + 1;
    });

    return interactions;
  }

  // Extract content type preferences
  extractContentTypePreferences(likes, comments) {
    const typeCount = {};

    [...likes, ...comments].forEach((activity) => {
      typeCount[activity.type] = (typeCount[activity.type] || 0) + 1;
    });

    return Object.entries(typeCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([type]) => type);
  }

  // Calculate active hours
  calculateActiveHours(likes, comments) {
    const hourlyActivity = new Array(24).fill(0);

    [...likes, ...comments].forEach((activity) => {
      const hour = new Date(activity.createdAt).getHours();
      hourlyActivity[hour]++;
    });

    // Normalize to 0-1 scale
    const maxActivity = Math.max(...hourlyActivity);
    return hourlyActivity.map((count) =>
      maxActivity > 0 ? count / maxActivity : 0
    );
  }

  // Extract recent authors
  extractRecentAuthors(likes, comments) {
    return [];
  }

  // Extract recent content types
  extractRecentTypes(likes, comments) {
    const recentTypes = [...likes, ...comments]
      .slice(0, 20) // Last 20 interactions
      .map((activity) => activity.type);

    return [...new Set(recentTypes)];
  }

  // Analyze user engagement patterns
  analyzeEngagementPattern(likes, comments) {
    const hourlyActivity = new Array(24).fill(0);
    const contentTypePreference = {};

    [...likes, ...comments].forEach((activity) => {
      const hour = new Date(activity.createdAt).getHours();
      hourlyActivity[hour]++;

      contentTypePreference[activity.type] =
        (contentTypePreference[activity.type] || 0) + 1;
    });

    return {
      activeHours: hourlyActivity,
      preferredTypes: Object.entries(contentTypePreference)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([type]) => type),
    };
  }

  // Get engagement metrics for content with optimization
  async getEngagementMetrics(contentIds) {
    const cacheKey = `engagement_${contentIds.join("_")}`;

    // Try optimized cache first
    let cached = this.feedOptimizer.getFromCache(cacheKey);
    if (cached) return cached;

    cached = engagementCache.get(cacheKey);
    if (cached) return cached;

    const [likes, comments, shares] = await Promise.all([
      Like.aggregate([
        { $match: { uid: { $in: contentIds } } },
        { $group: { _id: "$uid", count: { $sum: 1 } } },
      ]),
      Comment.aggregate([
        { $match: { uid: { $in: contentIds } } },
        { $group: { _id: "$uid", count: { $sum: 1 } } },
      ]),
      Content.aggregate([
        {
          $match: {
            "originalContent._id": { $in: contentIds },
            isShared: true,
          },
        },
        { $group: { _id: "$originalContent._id", count: { $sum: 1 } } },
      ]),
    ]);

    const metrics = {};
    contentIds.forEach((id) => {
      metrics[id] = {
        likes: likes.find((l) => l._id === id)?.count || 0,
        comments: comments.find((c) => c._id === id)?.count || 0,
        shares: shares.find((s) => s._id === id)?.count || 0,
      };
    });

    // Cache with optimization
    await this.feedOptimizer.cacheContent(cacheKey, metrics, {
      popularity: "warm",
    });
    engagementCache.set(cacheKey, metrics);

    return metrics;
  }

  // Enhanced ML-based content scoring using ContentRanking
  async calculateContentScore(content, userProfile, engagementMetrics) {
    const contentId = content._id.toString();
    const cacheKey = `ml_score_${contentId}_${userProfile.user._id}`;

    // Try optimized cache first
    let cached = this.feedOptimizer.getFromCache(cacheKey);
    if (cached) return cached;

    cached = mlScoreCache.get(cacheKey);
    if (cached) return cached;

    this.performanceMetrics.mlCalculations++;

    // Use ContentRanking algorithm for sophisticated scoring
    const rankingResult = this.contentRanking.calculateContentRank(
      content,
      userProfile,
      engagementMetrics[contentId] || {}
    );

    const score = rankingResult.finalScore;

    // Cache with optimization based on score
    const popularity = score > 0.8 ? "hot" : score > 0.5 ? "warm" : "cold";
    await this.feedOptimizer.cacheContent(cacheKey, score, {
      popularity,
      userEngagement: score,
      contentAge: Date.now() - new Date(content.createdAt).getTime(),
    });
    mlScoreCache.set(cacheKey, score);

    return score;
  }

  // Optimize content files for performance
  optimizeContentFiles(content, quality = "medium") {
    if (!content.files?.length) return content;

    // Use FeedOptimizer for advanced optimization
    const optimizedFiles = this.optimizeFileUrls(content.files, quality);

    return {
      ...content,
      optimizedFiles,
      files: optimizedFiles.map((f) => f.url || f.hls || f.original), // Maintain compatibility
      contentType: this.determineContentType(content.files),
    };
  }

  // Determine content type based on files
  determineContentType(files) {
    if (!files || !Array.isArray(files) || files.length === 0) {
      return "text";
    }

    const hasVideo = this.hasVideoFiles(files);
    const hasImage = this.hasImageFiles(files);

    if (hasVideo) return "video";
    if (hasImage) return "image";
    return "text";
  }

  // Fetch optimized content based on ML strategy (Content model only)
  async fetchOptimizedContent(
    filters,
    userProfile,
    limit,
    contentType = "all"
  ) {
    const fetchLimit = Math.min(limit * 3, 150); // Fetch more for better ML selection

    // Add content type filtering
    if (contentType === "video") {
      // Filter for content with video files
      filters.$expr = {
        $gt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$files", []] },
                cond: {
                  $regexMatch: {
                    input: "$$this",
                    regex: /\.(mp4|mov|webm|avi|mkv|m3u8)$/i,
                  },
                },
              },
            },
          },
          0,
        ],
      };
    } else if (contentType === "text") {
      // Filter for content without video files (text/image only)
      filters.$expr = {
        $eq: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$files", []] },
                cond: {
                  $regexMatch: {
                    input: "$$this",
                    regex: /\.(mp4|mov|webm|avi|mkv|m3u8)$/i,
                  },
                },
              },
            },
          },
          0,
        ],
      };
    }

    // Prioritize followed users content
    const followedContent = await Content.find({
      ...filters,
      "author.email": { $in: userProfile.followingEmails.slice(0, 100) },
    })
      .sort({ _id: -1 })
      .limit(Math.ceil(fetchLimit * 0.6))
      .lean();

    // Get discovery content
    const discoveryContent = await Content.find({
      ...filters,
      "author.email": { $nin: userProfile.followingEmails },
    })
      .sort({ _id: -1 })
      .limit(Math.ceil(fetchLimit * 0.4))
      .lean();

    // Combine and deduplicate
    const combined = [...followedContent, ...discoveryContent];
    const seen = new Set();
    return combined.filter((item) => {
      const id = item._id.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  // Score and optimize content
  async scoreAndOptimizeContent(
    content,
    userProfile,
    engagementMetrics,
    quality
  ) {
    const score = await this.calculateContentScore(
      content,
      userProfile,
      engagementMetrics
    );
    const optimized = this.optimizeContentFiles(content, quality);

    return {
      ...optimized,
      mlScore: score,
      priority: this.calculatePriority(content, userProfile),
    };
  }

  // Calculate content priority (new posts get boost)
  calculatePriority(content, userProfile) {
    const ageInMinutes =
      (Date.now() - new Date(content.createdAt).getTime()) / (1000 * 60);

    // New content boost (first 2 hours)
    if (ageInMinutes < 120) return 0.3;

    // Following's new content boost (first 6 hours)
    if (
      ageInMinutes < 360 &&
      userProfile.followingEmails.includes(content.author.email)
    ) {
      return 0.2;
    }

    return 0;
  }

  // Main feed generation method with full optimization (Content model only)
  async generatePersonalizedFeed(userId, userEmail, options = {}) {
    const startTime = Date.now();
    this.performanceMetrics.totalRequests++;

    const {
      page = 0,
      limit = 50,
      lastContentId = null,
      quality = "medium",
      contentType = "all", // 'all', 'video', 'text', 'image'
      trending = false,
      since = null,
    } = options;

    try {
      // Preload critical content in background
      const userProfile = await this.getUserProfile(userId, userEmail);

      // Start preloading for next request
      this.feedOptimizer.preloadCriticalContent(userId, userProfile, {
        preloadCount: limit,
        priority: "high",
      });

      // Build base filters
      const baseFilters = {};
      if (lastContentId) baseFilters._id = { $lt: lastContentId };
      if (trending && since) baseFilters.createdAt = { $gte: since };

      // Fetch content with optimization (Content model only)
      const content = await this.fetchOptimizedContent(
        baseFilters,
        userProfile,
        limit,
        contentType
      );

      // Get engagement metrics
      const contentIds = content.map((c) => c._id.toString());
      const engagementMetrics = await this.getEngagementMetrics(contentIds);

      // Calculate ML scores and sort using batch processing
      const scoredContent = await this.feedOptimizer.batchProcessContent(
        content,
        async (item) =>
          await this.scoreAndOptimizeContent(
            item,
            userProfile,
            engagementMetrics,
            quality
          ),
        { priority: "high" }
      );

      // Sort by ML score
      const sortedContent = scoredContent.sort((a, b) => b.mlScore - a.mlScore);

      // Enrich with user interaction data
      const enrichedFeed = await this.enrichWithUserData(
        sortedContent,
        userEmail
      );

      // Update performance metrics
      const responseTime = Date.now() - startTime;
      this.performanceMetrics.averageResponseTime =
        (this.performanceMetrics.averageResponseTime + responseTime) / 2;

      return {
        success: true,
        data: {
          feed: enrichedFeed.slice(0, limit),
          hasMore: enrichedFeed.length >= limit,
          nextCursor:
            enrichedFeed.length > 0
              ? enrichedFeed[enrichedFeed.length - 1]._id
              : null,
          mlMetrics: {
            totalProcessed: contentIds.length,
            cacheHitRate: this.calculateCacheHitRate(),
            diversityScore: this.calculateDiversityScore(enrichedFeed),
            responseTime,
            optimizationLevel: this.assessOptimizationLevel(),
          },
        },
      };
    } catch (error) {
      console.error("ML Feed Generation Error:", error);
      throw error;
    }
  }

  // Enrich content with user interaction data
  async enrichWithUserData(content, userEmail) {
    const contentIds = content.map((c) => c._id.toString());

    const [userLikes, userComments] = await Promise.all([
      Like.find({
        uid: { $in: contentIds },
        "user.email": userEmail,
      })
        .select("uid")
        .lean(),
      Comment.find({
        uid: { $in: contentIds },
        "user.email": userEmail,
      })
        .select("uid")
        .lean(),
    ]);

    const likedSet = new Set(userLikes.map((l) => l.uid));
    const commentedSet = new Set(userComments.map((c) => c.uid));

    return content.map((item) => ({
      ...item,
      userInteractions: {
        liked: likedSet.has(item._id.toString()),
        commented: commentedSet.has(item._id.toString()),
      },
      loadPriority: item.mlScore > 0.7 ? "high" : "normal",
    }));
  }

  // Calculate cache hit rate for monitoring
  calculateCacheHitRate() {
    const feedStats = feedCache.getStats();
    const optimizerRate = this.feedOptimizer.calculateOverallHitRate();

    const basicRate = feedStats.hits / (feedStats.hits + feedStats.misses) || 0;

    // Combine both cache systems
    return (basicRate + optimizerRate) / 2;
  }

  // Calculate diversity score
  calculateDiversityScore(feed) {
    const authors = new Set(feed.map((item) => item.author.email));
    const types = new Set(feed.map((item) => item.contentType || "text"));
    return (authors.size / feed.length) * (types.size / 3); // Normalize by max expected types (text, image, video)
  }

  // Assess optimization level
  assessOptimizationLevel() {
    const optimizerMetrics = this.feedOptimizer.getPerformanceMetrics();
    const rankingMetrics = this.contentRanking.getPerformanceMetrics();

    return {
      cacheEfficiency: optimizerMetrics.cacheEfficiency,
      systemHealth: optimizerMetrics.systemHealth.status,
      rankingEfficiency: rankingMetrics.efficiency,
      memoryOptimized: optimizerMetrics.memory.efficiency.hitRate > 0.7,
      overallScore: this.calculateOverallOptimizationScore(
        optimizerMetrics,
        rankingMetrics
      ),
    };
  }

  // Calculate overall optimization score
  calculateOverallOptimizationScore(optimizerMetrics, rankingMetrics) {
    const cacheScore = optimizerMetrics.cacheEfficiency * 0.4;
    const rankingScore = rankingMetrics.efficiency * 0.3;
    const memoryScore =
      (optimizerMetrics.memory.efficiency.hitRate > 0.7 ? 1 : 0.5) * 0.3;

    return cacheScore + rankingScore + memoryScore;
  }

  // Get comprehensive performance metrics
  getPerformanceMetrics() {
    return {
      mlService: this.performanceMetrics,
      feedOptimizer: this.feedOptimizer.getPerformanceMetrics(),
      contentRanking: this.contentRanking.getPerformanceMetrics(),
      cacheStats: {
        feed: feedCache.getStats(),
        userProfile: userProfileCache.getStats(),
        engagement: engagementCache.getStats(),
        mlScore: mlScoreCache.getStats(),
      },
      memoryUsage: process.memoryUsage(),
      systemHealth: this.feedOptimizer.assessSystemHealth(),
    };
  }

  // Clear caches (for testing/admin)
  clearCaches() {
    feedCache.flushAll();
    userProfileCache.flushAll();
    engagementCache.flushAll();
    mlScoreCache.flushAll();

    // Also clear optimizer caches
    this.feedOptimizer.optimizeMemoryUsage(true);
  }

  // Memory optimization with integrated approach
  optimizeMemoryUsage() {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;

    // Use FeedOptimizer for intelligent cleanup
    const optimized = this.feedOptimizer.optimizeMemoryUsage();

    // Additional ML-specific cleanup
    if (heapUsedMB > 500) {
      mlScoreCache.flushAll();
      console.log("Cleared ML score cache due to high memory usage");
    }

    if (heapUsedMB > 750) {
      engagementCache.flushAll();
      console.log("Cleared engagement cache due to high memory usage");
    }

    if (optimized) {
      this.performanceMetrics.optimizationEvents++;
      this.performanceMetrics.lastOptimization = new Date();
    }

    return optimized;
  }
}

// Export singleton instance
const mlFeedService = new MLFeedService();

// Auto-optimize memory every 30 minutes
setInterval(() => {
  mlFeedService.optimizeMemoryUsage();
}, 30 * 60 * 1000);

module.exports = mlFeedService;
