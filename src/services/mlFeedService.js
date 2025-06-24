const User = require("../modules/user/user.model");
const Content = require("../modules/contents/contents.model");
const Video = require("../modules/video/video.model");
const Follow = require("../modules/follow/follow.model");
const Like = require("../modules/likes/likes.model");
const Comment = require("../modules/comments/comments.model");
const NodeCache = require("node-cache");

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
  }

  // Get comprehensive user profile for ML
  async getUserProfile(userId, userEmail) {
    const cacheKey = `user_profile_${userId}`;
    const cached = userProfileCache.get(cacheKey);
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
    };

    userProfileCache.set(cacheKey, profile);
    return profile;
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

  // Get engagement metrics for content
  async getEngagementMetrics(contentIds) {
    const cacheKey = `engagement_${contentIds.join("_")}`;
    const cached = engagementCache.get(cacheKey);
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

    engagementCache.set(cacheKey, metrics);
    return metrics;
  }

  // Calculate ML-based content score
  async calculateContentScore(content, userProfile, engagementMetrics) {
    const contentId = content._id.toString();
    const cacheKey = `ml_score_${contentId}_${userProfile.user._id}`;
    const cached = mlScoreCache.get(cacheKey);
    if (cached) return cached;

    // Recency Score (0-1)
    const ageInHours =
      (Date.now() - new Date(content.createdAt).getTime()) / (1000 * 60 * 60);
    const recencyScore = Math.max(0, 1 - ageInHours / 168); // Decay over 1 week

    // Engagement Score (0-1)
    const metrics = engagementMetrics[contentId] || {
      likes: 0,
      comments: 0,
      shares: 0,
    };
    const engagementScore = Math.min(
      1,
      (metrics.likes * this.engagementWeights.like +
        metrics.comments * this.engagementWeights.comment +
        metrics.shares * this.engagementWeights.share +
        (content.views || 0) * this.engagementWeights.view) /
        100
    );

    // Relationship Score (0-1)
    const isFollowing = userProfile.followingEmails.includes(
      content.author.email
    );
    const isMutualFollow = userProfile.followingIds.includes(
      content.author._id
    );
    const relationshipScore = isFollowing ? (isMutualFollow ? 1 : 0.7) : 0.1;

    // User Preference Score (0-1)
    const hasInteracted =
      userProfile.recentLikes.includes(contentId) ||
      userProfile.recentComments.includes(contentId);
    const typePreference =
      userProfile.engagementPattern.preferredTypes.includes(content.type)
        ? 0.8
        : 0.4;
    const preferenceScore = hasInteracted ? 1 : typePreference;

    // Content Quality Score
    const qualityScore = this.calculateQualityScore(content);

    // Final weighted score
    const finalScore =
      recencyScore * this.contentWeights.recency +
      engagementScore * this.contentWeights.engagement +
      relationshipScore * this.contentWeights.relationship +
      preferenceScore * this.contentWeights.userPreference +
      qualityScore * 0.1; // Bonus for quality

    // Add randomness for diversity (Instagram-like)
    const diversityBonus = Math.random() * 0.15;
    const score = Math.min(1, finalScore + diversityBonus);

    mlScoreCache.set(cacheKey, score);
    return score;
  }

  // Calculate content quality score
  calculateQualityScore(content) {
    let score = 0.5; // Base score

    // Has media
    if (content.files?.length > 0) score += 0.2;

    // Has description
    if (content.status?.length > 10) score += 0.1;

    // Multiple media files
    if (content.files?.length > 1) score += 0.1;

    // Video content gets bonus
    if (content.type === "video" || content.videoUrl) score += 0.1;

    return Math.min(1, score);
  }

  // Optimize file URLs for performance
  optimizeContentFiles(content, quality = "medium") {
    if (!content.files?.length) return content;

    const optimizedFiles = content.files.map((file) => {
      const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(file);
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file);

      if (isVideo) {
        const basePath = file.replace(/\.[^/.]+$/, "");
        return {
          url: `${basePath}/playlist.m3u8`,
          thumbnail: `${basePath
            .split("/")
            .slice(0, -1)
            .join("/")}/thumbnails/${basePath.split("/").pop()}_thumb.jpg`,
          type: "video",
          quality: quality,
          streaming: true,
        };
      } else if (isImage) {
        const basePath = file.replace(/\.[^/.]+$/, "");
        const qualityMap = {
          low: `${basePath
            .split("/")
            .slice(0, -1)
            .join("/")}/thumbnails/${basePath.split("/").pop()}_thumb.jpg`,
          medium: `${basePath
            .split("/")
            .slice(0, -1)
            .join("/")}/compressed/${basePath.split("/").pop()}_compressed.jpg`,
          high: file,
        };
        return {
          url: qualityMap[quality] || qualityMap.medium,
          thumbnail: qualityMap.low,
          type: "image",
          quality: quality,
        };
      }

      return { url: file, type: "other" };
    });

    return {
      ...content,
      optimizedFiles,
      files: optimizedFiles.map((f) => f.url), // Maintain compatibility
    };
  }

  // Main feed generation method
  async generatePersonalizedFeed(userId, userEmail, options = {}) {
    const {
      page = 0,
      limit = 50,
      lastContentId = null,
      lastVideoId = null,
      quality = "medium",
      includeVideos = true,
      contentOnly = false,
    } = options;

    try {
      // Get user profile
      const userProfile = await getUserProfile(userId, userEmail);

      // Build base filters
      const baseFilters = {};
      if (lastContentId) baseFilters._id = { $lt: lastContentId };

      // Separate queries for content and videos
      const contentFilters = { ...baseFilters };
      const videoFilters = { ...baseFilters };
      if (lastVideoId) videoFilters._id = { $lt: lastVideoId };

      // Fetch content with ML-optimized strategy
      const [regularContent, videoContent] = await Promise.all([
        this.fetchOptimizedContent(
          contentFilters,
          userProfile,
          limit,
          "content"
        ),
        includeVideos
          ? this.fetchOptimizedContent(
              videoFilters,
              userProfile,
              limit,
              "video"
            )
          : [],
      ]);

      // Get engagement metrics
      const allContentIds = [
        ...regularContent.map((c) => c._id.toString()),
        ...videoContent.map((v) => v._id.toString()),
      ];
      const engagementMetrics = await this.getEngagementMetrics(allContentIds);

      // Calculate ML scores and sort
      const [scoredContent, scoredVideos] = await Promise.all([
        this.scoreAndSortContent(
          regularContent,
          userProfile,
          engagementMetrics,
          quality
        ),
        this.scoreAndSortContent(
          videoContent,
          userProfile,
          engagementMetrics,
          quality
        ),
      ]);

      // Apply Instagram-like mixing algorithm
      const mixedFeed = this.createInstagramLikeFeed(
        scoredContent,
        scoredVideos,
        contentOnly
      );

      // Enrich with user interaction data
      const enrichedFeed = await this.enrichWithUserData(mixedFeed, userEmail);

      return {
        success: true,
        data: {
          feed: enrichedFeed.slice(0, limit),
          videoContent: scoredVideos.slice(0, limit),
          regularContent: scoredContent.slice(0, limit),
          hasMoreContent: scoredContent.length >= limit,
          hasMoreVideos: scoredVideos.length >= limit,
          nextContentCursor:
            scoredContent.length > 0
              ? scoredContent[scoredContent.length - 1]._id
              : null,
          nextVideoCursor:
            scoredVideos.length > 0
              ? scoredVideos[scoredVideos.length - 1]._id
              : null,
          mlMetrics: {
            totalProcessed: allContentIds.length,
            cacheHitRate: this.calculateCacheHitRate(),
            diversityScore: this.calculateDiversityScore(enrichedFeed),
          },
        },
      };
    } catch (error) {
      console.error("ML Feed Generation Error:", error);
      throw error;
    }
  }

  // Fetch optimized content based on ML strategy
  async fetchOptimizedContent(filters, userProfile, limit, type) {
    const fetchLimit = Math.min(limit * 3, 150); // Fetch more for better ML selection

    // Prioritize followed users content
    const followedContent =
      type === "video"
        ? await Video.find({
            ...filters,
            "author.email": { $in: userProfile.followingEmails.slice(0, 100) },
          })
            .sort({ _id: -1 })
            .limit(Math.ceil(fetchLimit * 0.6))
            .lean()
        : await Content.find({
            ...filters,
            "author.email": { $in: userProfile.followingEmails.slice(0, 100) },
          })
            .sort({ _id: -1 })
            .limit(Math.ceil(fetchLimit * 0.6))
            .lean();

    // Get discovery content
    const discoveryContent =
      type === "video"
        ? await Video.find({
            ...filters,
            "author.email": { $nin: userProfile.followingEmails },
          })
            .sort({ _id: -1 })
            .limit(Math.ceil(fetchLimit * 0.4))
            .lean()
        : await Content.find({
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

  // Score and sort content using ML
  async scoreAndSortContent(content, userProfile, engagementMetrics, quality) {
    const scoredContent = await Promise.all(
      content.map(async (item) => {
        const score = await this.calculateContentScore(
          item,
          userProfile,
          engagementMetrics
        );
        const optimized = this.optimizeContentFiles(item, quality);
        return {
          ...optimized,
          mlScore: score,
          priority: this.calculatePriority(item, userProfile),
        };
      })
    );

    // Sort by ML score with priority boost
    return scoredContent.sort((a, b) => {
      const scoreA = a.mlScore + a.priority;
      const scoreB = b.mlScore + b.priority;
      return scoreB - scoreA;
    });
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

  // Create Instagram-like mixed feed
  createInstagramLikeFeed(regularContent, videoContent, contentOnly = false) {
    if (contentOnly) return regularContent;

    const mixed = [];
    let contentIndex = 0;
    let videoIndex = 0;

    // Instagram-like pattern: 2-3 regular posts, then 1 video
    while (
      contentIndex < regularContent.length ||
      videoIndex < videoContent.length
    ) {
      // Add 2-3 regular posts
      for (let i = 0; i < 3 && contentIndex < regularContent.length; i++) {
        mixed.push({ ...regularContent[contentIndex], feedType: "content" });
        contentIndex++;
      }

      // Add 1 video
      if (videoIndex < videoContent.length) {
        mixed.push({ ...videoContent[videoIndex], feedType: "video" });
        videoIndex++;
      }
    }

    return mixed;
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
    const stats = feedCache.getStats();
    return stats.hits / (stats.hits + stats.misses) || 0;
  }

  // Calculate diversity score
  calculateDiversityScore(feed) {
    const authors = new Set(feed.map((item) => item.author.email));
    const types = new Set(feed.map((item) => item.type || item.feedType));
    return (authors.size / feed.length) * (types.size / 5); // Normalize by max expected types
  }

  // Clear caches (for testing/admin)
  clearCaches() {
    feedCache.flushAll();
    userProfileCache.flushAll();
    engagementCache.flushAll();
    mlScoreCache.flushAll();
  }
}

module.exports = new MLFeedService();
