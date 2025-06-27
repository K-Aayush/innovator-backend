// MLFeedService.js
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
const seenContentCache = new NodeCache({ stdTTL: 86400 }); // 24 hours for seen content

class MLFeedService {
  constructor() {
    this.contentWeights = {
      recency: 0.3, // Increased weight for Instagram-like recency focus
      engagement: 0.35, // Higher weight for engagement
      relationship: 0.25, // Strong focus on followed users
      userPreference: 0.1, // Slightly reduced to balance exploration
    };

    this.engagementWeights = {
      like: 1,
      comment: 4, // Increased weight for comments (Instagram prioritizes comments)
      share: 6, // Increased weight for shares
      view: 0.2, // Slightly higher weight for views
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

    this.contentRanking = ContentRanking;
    this.feedOptimizer = FeedOptimizer;
  }

  // Helper to track seen content
  trackSeenContent(userId, contentIds) {
    const key = `seen_${userId}`;
    const existing = seenContentCache.get(key) || new Set();
    contentIds.forEach((id) => existing.add(id.toString()));
    seenContentCache.set(key, existing);
    return existing;
  }

  // Helper to get seen content
  getSeenContent(userId) {
    const key = `seen_${userId}`;
    return seenContentCache.get(key) || new Set();
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

        const qualities = {
          low: {
            url: thumbnailUrl,
            type: "image",
            isVideoThumbnail: true,
          },
          medium: {
            url: hlsUrl || file,
            type: "video",
            format: "hls",
            qualities: ["360p", "480p"],
            preload: "metadata", // Instagram-like preload for videos
          },
          high: {
            url: hlsUrl || file,
            type: "video",
            format: "hls",
            qualities: ["480p", "720p", "1080p"],
            preload: "auto", // Autoplay for high-priority videos
          },
          auto: {
            url: hlsUrl || file,
            type: "video",
            format: "hls",
            qualities: ["360p", "480p", "720p"],
            preload: "metadata",
          },
        };

        return {
          ...(qualities[quality] || qualities.auto),
          thumbnail: thumbnailUrl,
          original: file,
          hls: hlsUrl,
          fileSize: "streaming",
          autoplay: quality === "high" || quality === "auto", // Instagram-like autoplay
          muted: true, // Videos autoplay muted
        };
      } else if (isImage) {
        const thumbnailUrl = this.generateThumbnailUrl(file);

        const qualities = {
          low: { url: thumbnailUrl, width: 300, height: 200 },
          medium: { url: thumbnailUrl, width: 600, height: 400 },
          high: { url: file, width: "original", height: "original" },
          auto: { url: thumbnailUrl, width: 400, height: 300 },
        };

        return {
          ...(qualities[quality] || qualities.auto),
          type: "image",
          original: file,
          thumbnail: thumbnailUrl,
          progressiveLoading: true, // Instagram-like progressive image loading
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
    let cached =
      this.feedOptimizer.getFromCache(cacheKey) ||
      userProfileCache.get(cacheKey);
    if (cached) return cached;

    const [user, following, followers, recentLikes, recentComments] =
      await Promise.all([
        User.findById(userId)
          .select("interests level createdAt profession education location")
          .lean(),
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
      professionalInterests: user?.profession
        ? user.profession.toLowerCase().split(",")
        : [],
      location: user?.location || null,
    };

    await this.feedOptimizer.cacheContent(cacheKey, profile, {
      popularity: "hot",
      priority: "high",
    });
    userProfileCache.set(cacheKey, profile);
    return profile;
  }

  // Enhanced interaction map with Instagram-like weighting
  buildInteractionMap(likes, comments) {
    const interactions = {};
    likes.forEach((activity) => {
      interactions[activity.uid] =
        (interactions[activity.uid] || 0) + this.engagementWeights.like;
    });
    comments.forEach((activity) => {
      interactions[activity.uid] =
        (interactions[activity.uid] || 0) + this.engagementWeights.comment;
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

  // Calculate active hours with Instagram-like activity patterns
  calculateActiveHours(likes, comments) {
    const hourlyActivity = new Array(24).fill(0);
    [...likes, ...comments].forEach((activity) => {
      const hour = new Date(activity.createdAt).getHours();
      hourlyActivity[hour]++;
    });
    const maxActivity = Math.max(...hourlyActivity);
    return hourlyActivity.map((count) =>
      maxActivity > 0 ? count / maxActivity : 0
    );
  }

  extractRecentAuthors(likes, comments) {
    // Fetch author IDs from recent interactions
    return [
      ...new Set([...likes, ...comments].map((activity) => activity.user?._id)),
    ].slice(0, 20);
  }

  extractRecentTypes(likes, comments) {
    return [
      ...new Set(
        [...likes, ...comments].slice(0, 20).map((activity) => activity.type)
      ),
    ];
  }

  // Analyze engagement pattern with Instagram-like metrics
  analyzeEngagementPattern(likes, comments) {
    const hourlyActivity = new Array(24).fill(0);
    const contentTypePreference = {};
    const authorPreference = {};

    [...likes, ...comments].forEach((activity) => {
      const hour = new Date(activity.createdAt).getHours();
      hourlyActivity[hour]++;
      contentTypePreference[activity.type] =
        (contentTypePreference[activity.type] || 0) + 1;
      authorPreference[activity.user?._id] =
        (authorPreference[activity.user?._id] || 0) + 1;
    });

    return {
      activeHours: hourlyActivity,
      preferredTypes: Object.entries(contentTypePreference)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([type]) => type),
      preferredAuthors: Object.entries(authorPreference)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([authorId]) => authorId),
    };
  }

  // Get engagement metrics with Instagram-like metrics
  async getEngagementMetrics(contentIds) {
    const cacheKey = `engagement_${contentIds.join("_")}`;
    let cached =
      this.feedOptimizer.getFromCache(cacheKey) ||
      engagementCache.get(cacheKey);
    if (cached) return cached;

    const [likes, comments, shares, views] = await Promise.all([
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
      Content.aggregate([
        { $match: { _id: { $in: contentIds } } },
        { $group: { _id: "$_id", views: { $sum: "$views" } } },
      ]),
    ]);

    const metrics = {};
    contentIds.forEach((id) => {
      metrics[id] = {
        likes: likes.find((l) => l._id === id)?.count || 0,
        comments: comments.find((c) => c._id === id)?.count || 0,
        shares: shares.find((s) => s._id === id)?.count || 0,
        views: views.find((v) => v._id === id)?.views || 0,
      };
    });

    await this.feedOptimizer.cacheContent(cacheKey, metrics, {
      popularity: "warm",
    });
    engagementCache.set(cacheKey, metrics);
    return metrics;
  }

  // Enhanced ML-based content scoring with Instagram-like prioritization
  async calculateContentScore(content, userProfile, engagementMetrics) {
    const contentId = content._id.toString();
    const cacheKey = `ml_score_${contentId}_${userProfile.user._id}`;
    let cached =
      this.feedOptimizer.getFromCache(cacheKey) || mlScoreCache.get(cacheKey);
    if (cached) return cached;

    this.performanceMetrics.mlCalculations++;

    const recencyScore = this.calculateRecencyScore(content.createdAt);
    const engagementScore = this.calculateEngagementScore(engagementMetrics);
    const relationshipScore = this.calculateRelationshipScore(
      content,
      userProfile
    );
    const preferenceScore = this.calculatePreferenceScore(content, userProfile);

    const score =
      this.contentWeights.recency * recencyScore +
      this.contentWeights.engagement * engagementScore +
      this.contentWeights.relationship * relationshipScore +
      this.contentWeights.userPreference * preferenceScore;

    const boostedScore = this.applyInstagramBoosts(score, content, userProfile);
    await this.feedOptimizer.cacheContent(cacheKey, boostedScore, {
      popularity:
        boostedScore > 0.8 ? "hot" : boostedScore > 0.5 ? "warm" : "cold",
      userEngagement: boostedScore,
      contentAge: Date.now() - new Date(content.createdAt).getTime(),
    });
    mlScoreCache.set(cacheKey, boostedScore);
    return boostedScore;
  }

  // Instagram-like recency score
  calculateRecencyScore(createdAt) {
    const ageInHours =
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
    if (ageInHours < 2) return 1; // Maximum boost for posts < 2 hours
    if (ageInHours < 24) return 0.8 - (ageInHours / 24) * 0.3; // Gradual decay
    if (ageInHours < 48) return 0.5 - (ageInHours / 48) * 0.2;
    return 0.3; // Baseline for older posts
  }

  // Instagram-like engagement score
  calculateEngagementScore(metrics) {
    const totalEngagement =
      (metrics.likes || 0) * this.engagementWeights.like +
      (metrics.comments || 0) * this.engagementWeights.comment +
      (metrics.shares || 0) * this.engagementWeights.share +
      (metrics.views || 0) * this.engagementWeights.view;

    return Math.min(totalEngagement / 1000, 1); // Normalize to 0-1
  }

  // Instagram-like relationship score
  calculateRelationshipScore(content, userProfile) {
    if (userProfile.followingEmails.includes(content.author.email)) return 1;
    if (userProfile.recentlySeenAuthors.includes(content.author._id))
      return 0.7;
    return 0.3; // Baseline for non-followed content
  }

  // Instagram-like preference score
  calculatePreferenceScore(content, userProfile) {
    let score = 0.3; // Baseline
    if (userProfile.preferredContentTypes.includes(content.type)) score += 0.3;
    if (
      userProfile.professionalInterests.some((interest) =>
        content.status?.toLowerCase().includes(interest)
      )
    )
      score += 0.2;
    if (
      userProfile.location &&
      content.status?.toLowerCase().includes(userProfile.location.toLowerCase())
    )
      score += 0.2;
    return Math.min(score, 1);
  }

  // Instagram-like boosts (e.g., Stories, Live, Sponsored)
  applyInstagramBoosts(score, content, userProfile) {
    let boostedScore = score;
    const ageInMinutes =
      (Date.now() - new Date(content.createdAt).getTime()) / (1000 * 60);
    if (
      ageInMinutes < 120 &&
      userProfile.followingEmails.includes(content.author.email)
    )
      boostedScore += 0.3; // Boost followed users' new posts
    if (content.views > 1000) boostedScore += 0.2; // Boost trending content
    if (content.isShared) boostedScore += 0.1; // Slight boost for shared content
    return Math.min(boostedScore, 1);
  }

  // Optimize content files for performance
  optimizeContentFiles(content, quality = "medium") {
    if (!content.files?.length) return content;

    const optimizedFiles = this.optimizeFileUrls(content.files, quality);
    return {
      ...content,
      optimizedFiles,
      files: optimizedFiles.map((f) => f.url || f.hls || f.original),
      contentType: this.determineContentType(content.files),
      isSponsored: false, // Placeholder for future ad integration
    };
  }

  // Determine content type
  determineContentType(files) {
    if (!files || !Array.isArray(files) || files.length === 0) return "text";
    return this.hasVideoFiles(files)
      ? "video"
      : this.hasImageFiles(files)
      ? "image"
      : "text";
  }

  // Fetch optimized content with Instagram-like diversity
  async fetchOptimizedContent(
    filters,
    userProfile,
    limit,
    contentType = "all",
    options = {}
  ) {
    const {
      excludeIds = [],
      refreshStrategy = null,
      forceRefresh = false,
      cursor = null,
    } = options;

    const fetchLimit = Math.min(limit * 3, 150);
    if (excludeIds.length > 0) {
      filters._id = {
        ...filters._id,
        $nin: excludeIds.map((id) =>
          typeof id === "string" ? id : id.toString()
        ),
      };
    }

    if (cursor) {
      filters._id = { ...filters._id, $lt: cursor };
    }

    // Instagram-like content type filtering
    if (contentType === "video") {
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

    let sortStrategy = { createdAt: -1, views: -1 }; // Instagram-like default sort
    if (refreshStrategy) {
      sortStrategy = refreshStrategy.sort;
    } else if (forceRefresh) {
      sortStrategy = [
        { createdAt: -1, views: -1 },
        { engagementScore: -1 },
        { _id: -1 },
      ][Math.floor(Math.random() * 3)];
    }

    // Instagram-like content mix: 60% followed, 30% discovery, 10% trending
    const followedRatio = 0.6;
    const discoveryRatio = 0.3;
    const trendingRatio = 0.1;

    const [followedContent, discoveryContent, trendingContent] =
      await Promise.all([
        Content.find({
          ...filters,
          "author.email": { $in: userProfile.followingEmails.slice(0, 100) },
        })
          .sort(sortStrategy)
          .limit(Math.ceil(fetchLimit * followedRatio))
          .lean(),
        Content.find({
          ...filters,
          "author.email": { $nin: userProfile.followingEmails },
        })
          .sort({ views: -1, createdAt: -1 })
          .limit(Math.ceil(fetchLimit * discoveryRatio))
          .lean(),
        Content.find({
          ...filters,
          views: { $gt: 1000 }, // Trending threshold
        })
          .sort({ views: -1, createdAt: -1 })
          .limit(Math.ceil(fetchLimit * trendingRatio))
          .lean(),
      ]);

    // Combine and deduplicate
    const combined = [
      ...followedContent,
      ...discoveryContent,
      ...trendingContent,
    ];
    const seen = new Set();
    const deduplicated = combined.filter((item) => {
      const id = item._id.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Instagram-like randomization for refresh
    return forceRefresh ? this.shuffleArray(deduplicated) : deduplicated;
  }

  // Fisher-Yates shuffle
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
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
      isSponsored: false, // Placeholder for future ad integration
    };
  }

  // Calculate content priority with Instagram-like boosts
  calculatePriority(content, userProfile) {
    const ageInMinutes =
      (Date.now() - new Date(content.createdAt).getTime()) / (1000 * 60);
    if (ageInMinutes < 60) return 0.5; // High priority for posts < 1 hour
    if (
      ageInMinutes < 120 &&
      userProfile.followingEmails.includes(content.author.email)
    )
      return 0.4;
    if (content.views > 1000) return 0.3; // Boost trending content
    return 0.2; // Default priority
  }

  // Main Instagram-like feed generation
  async generateInstagramFeed(userId, userEmail, options = {}) {
    const startTime = Date.now();
    this.performanceMetrics.totalRequests++;

    const {
      cursor = null,
      limit = 20,
      contentType = "all",
      excludeIds = [],
      quality = "medium",
      forceRefresh = false,
    } = options;

    try {
      const seenContent = this.getSeenContent(userId);
      const allExcludedIds = [...excludeIds, ...Array.from(seenContent)];

      const userProfile = await this.getUserProfile(userId, userEmail);

      // Preload next batch
      if (!forceRefresh) {
        this.feedOptimizer.preloadCriticalContent(userId, userProfile, {
          preloadCount: limit * 2,
          priority: "high",
        });
      }

      // Fetch content
      const content = await this.fetchOptimizedContent(
        {},
        userProfile,
        limit,
        contentType,
        { excludeIds: allExcludedIds, cursor, forceRefresh }
      );

      // Get engagement metrics
      const contentIds = content.map((c) => c._id.toString());
      const engagementMetrics = await this.getEngagementMetrics(contentIds);

      // Score and optimize
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

      // Instagram-like sorting with randomization
      let sortedContent = scoredContent.sort(
        (a, b) => b.mlScore + b.priority - (a.mlScore + a.priority)
      );
      if (forceRefresh) {
        sortedContent = this.shuffleArray(sortedContent).map((item) => ({
          ...item,
          mlScore: item.mlScore + (Math.random() * 0.2 - 0.1), // ±0.1 randomization
        }));
      }

      // Enrich with user interactions
      const enrichedFeed = await this.enrichWithUserData(
        sortedContent,
        userEmail
      );

      // Track seen content
      const newContentIds = enrichedFeed.map((item) => item._id.toString());
      this.trackSeenContent(userId, newContentIds);

      // Update performance metrics
      const responseTime = Date.now() - startTime;
      this.performanceMetrics.averageResponseTime =
        (this.performanceMetrics.averageResponseTime *
          this.performanceMetrics.totalRequests +
          responseTime) /
        (this.performanceMetrics.totalRequests + 1);

      const hasMore = enrichedFeed.length >= limit;
      const finalFeed = enrichedFeed.slice(0, limit);

      return {
        success: true,
        data: {
          feed: finalFeed,
          hasMore,
          nextCursor:
            finalFeed.length > 0 ? finalFeed[finalFeed.length - 1]._id : null,
          metrics: {
            totalProcessed: contentIds.length,
            cacheHitRate: this.calculateCacheHitRate(),
            diversityScore: this.calculateDiversityScore(finalFeed),
            responseTime,
            optimizationLevel: this.assessOptimizationLevel(),
            excludedCount: allExcludedIds.length,
            refreshStrategy: forceRefresh ? "random" : "instagram-like",
          },
        },
      };
    } catch (error) {
      console.error("Instagram Feed Generation Error:", error);
      throw error;
    }
  }

  // Refresh feed with Instagram-like strategy
  async refreshFeedStrategy(userId, userEmail, contentType = "all") {
    try {
      // Clear relevant caches
      this.clearCaches();

      // Randomize sorting for fresh content
      const refreshStrategy = {
        strategy: "random-exploration",
        sort: { createdAt: -1, views: -1, _id: -1 },
      };

      const result = await this.generateInstagramFeed(userId, userEmail, {
        limit: 50,
        contentType,
        forceRefresh: true,
        refreshStrategy,
      });

      return {
        success: true,
        data: {
          feed: result.data.feed,
          hasMore: result.data.hasMore,
          nextCursor: result.data.nextCursor,
          metrics: {
            ...result.data.metrics,
            refreshStrategy: "instagram-like-exploration",
          },
        },
      };
    } catch (error) {
      console.error("RefreshFeedStrategy error:", error);
      throw error;
    }
  }

  // Enrich with user data
  async enrichWithUserData(content, userEmail) {
    const contentIds = content.map((c) => c._id.toString());
    const [userLikes, userComments] = await Promise.all([
      Like.find({ uid: { $in: contentIds }, "user.email": userEmail })
        .select("uid")
        .lean(),
      Comment.find({ uid: { $in: contentIds }, "user.email": userEmail })
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
      loadPriority:
        item.mlScore > 0.7 ? "high" : item.mlScore > 0.4 ? "normal" : "low",
    }));
  }

  // Calculate cache hit rate
  calculateCacheHitRate() {
    const feedStats = feedCache.getStats();
    const optimizerRate = this.feedOptimizer.calculateOverallHitRate();
    const basicRate = feedStats.hits / (feedStats.hits + feedStats.misses) || 0;
    return (basicRate + optimizerRate) / 2;
  }

  // Calculate diversity score
  calculateDiversityScore(feed) {
    const authors = new Set(feed.map((item) => item.author.email));
    const types = new Set(feed.map((item) => item.contentType || "text"));
    return (authors.size / Math.max(feed.length, 1)) * (types.size / 3);
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

  calculateOverallOptimizationScore(optimizerMetrics, rankingMetrics) {
    const cacheScore = optimizerMetrics.cacheEfficiency * 0.4;
    const rankingScore = rankingMetrics.efficiency * 0.3;
    const memoryScore =
      optimizerMetrics.memory.efficiency.hitRate > 0.7 ? 1 : 0.5 * 0.3;
    return cacheScore + rankingScore + memoryScore;
  }

  // Get performance metrics
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
        seenContent: seenContentCache.getStats(),
      },
      memoryUsage: process.memoryUsage(),
      systemHealth: this.feedOptimizer.assessSystemHealth(),
    };
  }

  // Clear all caches
  clearCaches() {
    feedCache.flushAll();
    userProfileCache.flushAll();
    engagementCache.flushAll();
    mlScoreCache.flushAll();
    seenContentCache.flushAll();
    this.feedOptimizer.optimizeMemoryUsage(true);
  }

  // Memory optimization
  optimizeMemoryUsage() {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const optimized = this.feedOptimizer.optimizeMemoryUsage();

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

const mlFeedService = new MLFeedService();
setInterval(() => mlFeedService.optimizeMemoryUsage(), 30 * 60 * 1000);
module.exports = mlFeedService;
