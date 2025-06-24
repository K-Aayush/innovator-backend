class ContentRankingAlgorithm {
  constructor() {
    // Instagram-like ranking factors
    this.rankingFactors = {
      // Time-based factors
      recency: {
        weight: 0.25,
        decayRate: 0.1, // How fast content loses recency score
      },

      // Engagement factors
      engagement: {
        weight: 0.3,
        metrics: {
          likes: 1,
          comments: 3,
          shares: 5,
          saves: 4,
          views: 0.1,
        },
      },

      // Relationship factors
      relationship: {
        weight: 0.25,
        scores: {
          following: 1.0,
          mutualFollowing: 1.2,
          closeFreind: 1.5,
          stranger: 0.1,
        },
      },

      // User behavior factors
      userBehavior: {
        weight: 0.2,
        factors: {
          previousInteractions: 1.0,
          contentTypePreference: 0.8,
          timeOfDayPreference: 0.6,
          deviceTypePreference: 0.4,
        },
      },
    };

    // Content quality indicators
    this.qualityFactors = {
      hasMedia: 0.2,
      hasDescription: 0.1,
      multipleMedia: 0.15,
      videoContent: 0.25,
      highResolution: 0.1,
      properAspectRatio: 0.1,
      goodLighting: 0.1, // Future: AI-based quality detection
    };
  }

  // Calculate time decay score
  calculateRecencyScore(createdAt) {
    const ageInHours =
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);

    // Instagram-like time decay
    if (ageInHours < 1) return 1.0; // Perfect score for first hour
    if (ageInHours < 6) return 0.9; // High score for first 6 hours
    if (ageInHours < 24) return 0.7; // Good score for first day
    if (ageInHours < 72) return 0.5; // Medium score for first 3 days
    if (ageInHours < 168) return 0.3; // Low score for first week

    return Math.max(
      0.1,
      1 / (1 + ageInHours * this.rankingFactors.recency.decayRate)
    );
  }

  // Calculate engagement score
  calculateEngagementScore(metrics) {
    const {
      likes = 0,
      comments = 0,
      shares = 0,
      saves = 0,
      views = 0,
    } = metrics;
    const engagementMetrics = this.rankingFactors.engagement.metrics;

    const rawScore =
      likes * engagementMetrics.likes +
      comments * engagementMetrics.comments +
      shares * engagementMetrics.shares +
      saves * engagementMetrics.saves +
      views * engagementMetrics.views;

    // Normalize to 0-1 scale using logarithmic scaling
    return Math.min(1, Math.log10(rawScore + 1) / 3);
  }

  // Calculate relationship score
  calculateRelationshipScore(authorId, userProfile) {
    const { followingIds, mutualFollowingIds, closeFreinds = [] } = userProfile;
    const scores = this.rankingFactors.relationship.scores;

    if (closeFreinds.includes(authorId)) return scores.closeFreind;
    if (mutualFollowingIds?.includes(authorId)) return scores.mutualFollowing;
    if (followingIds?.includes(authorId)) return scores.following;

    return scores.stranger;
  }

  // Calculate user behavior score
  calculateUserBehaviorScore(content, userProfile) {
    const factors = this.rankingFactors.userBehavior.factors;
    let score = 0;

    // Previous interactions with this author
    if (userProfile.previousInteractions?.[content.author._id]) {
      score += factors.previousInteractions;
    }

    // Content type preference
    if (userProfile.preferredContentTypes?.includes(content.type)) {
      score += factors.contentTypePreference;
    }

    // Time of day preference
    const currentHour = new Date().getHours();
    if (userProfile.activeHours?.[currentHour] > 0.5) {
      score += factors.timeOfDayPreference;
    }

    // Device type preference (mobile vs desktop)
    if (
      userProfile.devicePreference === "mobile" &&
      content.optimizedForMobile
    ) {
      score += factors.deviceTypePreference;
    }

    return Math.min(1, score);
  }

  // Calculate content quality score
  calculateQualityScore(content) {
    let score = 0.5; // Base score

    // Has media files
    if (content.files?.length > 0) {
      score += this.qualityFactors.hasMedia;
    }

    // Has description
    if (content.status?.length > 20) {
      score += this.qualityFactors.hasDescription;
    }

    // Multiple media files
    if (content.files?.length > 1) {
      score += this.qualityFactors.multipleMedia;
    }

    // Video content
    if (content.type === "video" || content.videoUrl) {
      score += this.qualityFactors.videoContent;
    }

    // High resolution (future enhancement)
    if (content.metadata?.highResolution) {
      score += this.qualityFactors.highResolution;
    }

    return Math.min(1, score);
  }

  // Main ranking algorithm
  calculateContentRank(content, userProfile, engagementMetrics) {
    const recencyScore = this.calculateRecencyScore(content.createdAt);
    const engagementScore = this.calculateEngagementScore(engagementMetrics);
    const relationshipScore = this.calculateRelationshipScore(
      content.author._id,
      userProfile
    );
    const behaviorScore = this.calculateUserBehaviorScore(content, userProfile);
    const qualityScore = this.calculateQualityScore(content);

    // Calculate weighted final score
    const finalScore =
      recencyScore * this.rankingFactors.recency.weight +
      engagementScore * this.rankingFactors.engagement.weight +
      relationshipScore * this.rankingFactors.relationship.weight +
      behaviorScore * this.rankingFactors.userBehavior.weight +
      qualityScore * 0.1; // Quality bonus

    // Add diversity factor (Instagram uses this to prevent echo chambers)
    const diversityBonus = this.calculateDiversityBonus(content, userProfile);

    // Add time-sensitive boost for new content
    const newContentBoost = this.calculateNewContentBoost(content, userProfile);

    return {
      finalScore: Math.min(1, finalScore + diversityBonus + newContentBoost),
      breakdown: {
        recency: recencyScore,
        engagement: engagementScore,
        relationship: relationshipScore,
        behavior: behaviorScore,
        quality: qualityScore,
        diversity: diversityBonus,
        newContentBoost,
      },
    };
  }

  // Calculate diversity bonus to prevent echo chambers
  calculateDiversityBonus(content, userProfile) {
    const recentAuthors = userProfile.recentlySeenAuthors || [];
    const recentTypes = userProfile.recentlySeenTypes || [];

    let bonus = 0;

    // Bonus for new authors
    if (!recentAuthors.includes(content.author._id)) {
      bonus += 0.1;
    }

    // Bonus for different content types
    if (!recentTypes.includes(content.type)) {
      bonus += 0.05;
    }

    return bonus;
  }

  // Calculate boost for new content from followed users
  calculateNewContentBoost(content, userProfile) {
    const ageInMinutes =
      (Date.now() - new Date(content.createdAt).getTime()) / (1000 * 60);
    const isFollowing = userProfile.followingIds?.includes(content.author._id);

    // Boost new content from followed users
    if (isFollowing && ageInMinutes < 120) {
      // First 2 hours
      return 0.2;
    }

    // Smaller boost for very new content from anyone
    if (ageInMinutes < 30) {
      // First 30 minutes
      return 0.1;
    }

    return 0;
  }

  // Instagram-like feed mixing algorithm
  mixFeedContent(rankedContent, rankedVideos, options = {}) {
    const {
      contentVideoRatio = 3, // 3 content posts per 1 video
      maxConsecutiveVideos = 2,
      maxConsecutiveContent = 4,
      shuffleWithinGroups = true,
    } = options;

    const mixed = [];
    let contentIndex = 0;
    let videoIndex = 0;
    let consecutiveContent = 0;
    let consecutiveVideos = 0;

    while (
      contentIndex < rankedContent.length ||
      videoIndex < rankedVideos.length
    ) {
      // Decide whether to add content or video
      const shouldAddVideo =
        consecutiveContent >= maxConsecutiveContent ||
        (consecutiveContent >= contentVideoRatio &&
          consecutiveVideos < maxConsecutiveVideos) ||
        (contentIndex >= rankedContent.length &&
          videoIndex < rankedVideos.length);

      if (shouldAddVideo && videoIndex < rankedVideos.length) {
        mixed.push({ ...rankedVideos[videoIndex], feedType: "video" });
        videoIndex++;
        consecutiveVideos++;
        consecutiveContent = 0;
      } else if (contentIndex < rankedContent.length) {
        mixed.push({ ...rankedContent[contentIndex], feedType: "content" });
        contentIndex++;
        consecutiveContent++;
        consecutiveVideos = 0;
      } else {
        break;
      }
    }

    // Add some randomness within score groups for diversity
    if (shuffleWithinGroups) {
      return this.shuffleWithinScoreGroups(mixed);
    }

    return mixed;
  }

  // Shuffle content within similar score groups
  shuffleWithinScoreGroups(content) {
    const scoreGroups = {
      high: [], // 0.8 - 1.0
      medium: [], // 0.5 - 0.8
      low: [], // 0.0 - 0.5
    };

    content.forEach((item) => {
      const score = item.finalScore || item.mlScore || 0;
      if (score >= 0.8) scoreGroups.high.push(item);
      else if (score >= 0.5) scoreGroups.medium.push(item);
      else scoreGroups.low.push(item);
    });

    // Shuffle within each group
    Object.keys(scoreGroups).forEach((group) => {
      scoreGroups[group] = this.shuffleArray(scoreGroups[group]);
    });

    return [...scoreGroups.high, ...scoreGroups.medium, ...scoreGroups.low];
  }

  // Fisher-Yates shuffle algorithm
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Update ranking weights based on user feedback (future enhancement)
  updateRankingWeights(userFeedback) {
    // This would use machine learning to adjust weights based on user behavior
    // For now, it's a placeholder for future ML integration
    console.log(
      "Updating ranking weights based on user feedback:",
      userFeedback
    );
  }
}

module.exports = new ContentRankingAlgorithm();
