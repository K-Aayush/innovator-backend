const Content = require("./contents.model");
const User = require("../user/user.model");
const Follow = require("../follow/follow.model");
const Like = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const NodeCache = require("node-cache");

// Cache for randomized feed optimization
const randomizedFeedCache = new NodeCache({ stdTTL: 180 });
const userSeenCache = new NodeCache({ stdTTL: 86400 });
const userProfileCache = new NodeCache({ stdTTL: 600 });

// Helper function to check if content has video files
const hasVideoFiles = (files) => {
  if (!files || !Array.isArray(files)) return false;
  const videoExtensions = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m3u8"];
  return files.some((file) =>
    videoExtensions.some((ext) => file.toLowerCase().endsWith(ext))
  );
};

// Helper function to check if content has image files
const hasImageFiles = (files) => {
  if (!files || !Array.isArray(files)) return false;
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
  return files.some((file) =>
    imageExtensions.some((ext) => file.toLowerCase().endsWith(ext))
  );
};

// Determine content type
const determineContentType = (files) => {
  if (!files || !Array.isArray(files) || files.length === 0) return "text";
  if (hasVideoFiles(files)) return "video";
  if (hasImageFiles(files)) return "image";
  return "text";
};

// Fisher-Yates shuffle algorithm
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Track seen content for user
const trackSeenContent = (userId, contentIds) => {
  const key = `seen_content_${userId}`;
  const seenContent = userSeenCache.get(key) || new Set();
  contentIds.forEach((id) => seenContent.add(id.toString()));
  userSeenCache.set(key, seenContent);
  return seenContent;
};

// Get seen content for user
const getSeenContent = (userId) => {
  const key = `seen_content_${userId}`;
  return userSeenCache.get(key) || new Set();
};

// Clear seen content for user
const clearSeenContent = (userId) => {
  const key = `seen_content_${userId}`;
  userSeenCache.del(key);
  return new Set();
};

// Calculate engagement score for content
const calculateEngagementScore = (likes, comments, views, shares = 0) => {
  const totalEngagement = likes * 1 + comments * 3 + shares * 5 + views * 0.1;
  return Math.min(totalEngagement / 100, 10);
};

// Get comprehensive user profile for personalization
const getUserProfile = async (userId, userEmail) => {
  const cacheKey = `user_profile_${userId}`;
  const cached = userProfileCache.get(cacheKey);
  if (cached) return cached;

  try {
    const [user, following, recentLikes, recentComments] = await Promise.all([
      User.findById(userId)
        .select(
          "interests level profession education location gender bio createdAt"
        )
        .lean(),
      Follow.find({ "follower._id": userId })
        .select("following.email following._id following.name")
        .limit(200)
        .lean(),
      Like.find({ "user.email": userEmail })
        .sort({ createdAt: -1 })
        .limit(100)
        .select("uid createdAt type")
        .lean(),
      Comment.find({ "user.email": userEmail })
        .sort({ createdAt: -1 })
        .limit(50)
        .select("uid createdAt type")
        .lean(),
    ]);

    // Analyze user behavior patterns
    const contentTypePreferences = analyzeContentTypePreferences(
      recentLikes,
      recentComments
    );
    const activityPattern = analyzeActivityPattern(recentLikes, recentComments);
    const interactionHistory = buildInteractionHistory(
      recentLikes,
      recentComments
    );

    const profile = {
      user: user || {},
      followingEmails: following.map((f) => f.following.email),
      followingIds: following.map((f) => f.following._id),
      followingNames: following.map((f) => f.following.name),
      recentLikedContent: recentLikes.map((l) => l.uid),
      recentCommentedContent: recentComments.map((c) => c.uid),
      interactionHistory,

      // User preferences from profile
      interests: user?.interests || [],
      profession: user?.profession || "",
      education: user?.education || "",
      location: user?.location || "",
      userLevel: user?.level || "bronze",
      accountAge: user?.createdAt
        ? Date.now() - new Date(user.createdAt).getTime()
        : 0,

      // Behavioral analysis
      contentTypePreferences,
      activityPattern,
      preferredAuthors: extractPreferredAuthors(recentLikes, recentComments),
      engagementStyle: analyzeEngagementStyle(recentLikes, recentComments),
    };

    userProfileCache.set(cacheKey, profile);
    return profile;
  } catch (error) {
    console.error("Error getting user profile:", error);
    // Return minimal profile on error
    return {
      user: {},
      followingEmails: [],
      followingIds: [],
      followingNames: [],
      recentLikedContent: [],
      recentCommentedContent: [],
      interactionHistory: new Set(),
      interests: [],
      profession: "",
      education: "",
      location: "",
      userLevel: "bronze",
      accountAge: 0,
      contentTypePreferences: {},
      activityPattern: {},
      preferredAuthors: [],
      engagementStyle: "casual",
    };
  }
};

// Analyze content type preferences based on user interactions
const analyzeContentTypePreferences = (likes, comments) => {
  const typeCount = {};
  const interactions = [...likes, ...comments];

  interactions.forEach((interaction) => {
    const type = interaction.type || "content";
    typeCount[type] = (typeCount[type] || 0) + 1;
  });

  // Calculate preferences as percentages
  const total = interactions.length || 1;
  const preferences = {};
  Object.keys(typeCount).forEach((type) => {
    preferences[type] = typeCount[type] / total;
  });

  return preferences;
};

// Analyze user activity patterns
const analyzeActivityPattern = (likes, comments) => {
  const hourlyActivity = new Array(24).fill(0);
  const dailyActivity = new Array(7).fill(0);

  [...likes, ...comments].forEach((activity) => {
    const date = new Date(activity.createdAt);
    const hour = date.getHours();
    const day = date.getDay();

    hourlyActivity[hour]++;
    dailyActivity[day]++;
  });

  return {
    hourlyActivity,
    dailyActivity,
    mostActiveHour: hourlyActivity.indexOf(Math.max(...hourlyActivity)),
    mostActiveDay: dailyActivity.indexOf(Math.max(...dailyActivity)),
  };
};

// Build interaction history
const buildInteractionHistory = (likes, comments) => {
  const history = new Set();
  [...likes, ...comments].forEach((activity) => {
    history.add(activity.uid);
  });
  return history;
};

// Analyze engagement style
const analyzeEngagementStyle = (likes, comments) => {
  const likeCount = likes.length;
  const commentCount = comments.length;

  if (commentCount > likeCount * 0.5) return "conversational";
  if (likeCount > commentCount * 3) return "passive";
  return "casual";
};

// Calculate content relevance score based on user profile
const calculateContentRelevanceScore = (content, userProfile) => {
  let score = 0.5; // Base score

  // Interest matching
  if (userProfile.interests.length > 0) {
    const contentText = (content.status || "").toLowerCase();
    const matchingInterests = userProfile.interests.filter((interest) =>
      contentText.includes(interest.toLowerCase())
    );
    score += (matchingInterests.length / userProfile.interests.length) * 0.3;
  }

  // Profession/education relevance
  if (userProfile.profession) {
    const contentText = (content.status || "").toLowerCase();
    if (contentText.includes(userProfile.profession.toLowerCase())) {
      score += 0.2;
    }
  }

  // Location relevance
  if (userProfile.location) {
    const contentText = (content.status || "").toLowerCase();
    if (contentText.includes(userProfile.location.toLowerCase())) {
      score += 0.15;
    }
  }

  // Content type preference
  const contentType = determineContentType(content.files);
  if (userProfile.contentTypePreferences[contentType]) {
    score += userProfile.contentTypePreferences[contentType] * 0.25;
  }

  // Author preference (if following)
  if (userProfile.followingEmails.includes(content.author.email)) {
    score += 0.4;
  }

  // Previous interaction bonus
  if (userProfile.interactionHistory.has(content._id.toString())) {
    score += 0.1;
  }

  // Account age factor (newer users get more diverse content)
  if (userProfile.accountAge < 30 * 24 * 60 * 60 * 1000) {
    // Less than 30 days
    score += 0.1; // Boost for new users to help discovery
  }

  return Math.min(score, 1);
};

// Enhanced content fetching with user profile integration
const fetchPersonalizedRandomContent = async (
  userId,
  userProfile,
  excludeIds,
  limit,
  cursor,
  contentType
) => {
  const fetchLimit = Math.min(limit * 4, 200);

  // Build base filters
  const baseFilters = {
    _id: {
      $nin: excludeIds
        .map((id) => (isValidObjectId(id) ? id : null))
        .filter(Boolean),
    },
  };

  // Add cursor pagination
  if (cursor && isValidObjectId(cursor)) {
    baseFilters._id.$lt = cursor;
  }

  // Content type filtering
  if (contentType === "video") {
    baseFilters.$expr = {
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
  } else if (contentType === "normal") {
    baseFilters.$expr = {
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

  // Enhanced strategy based on user profile
  const followedRatio =
    userProfile.engagementStyle === "conversational" ? 0.7 : 0.5;
  const discoveryRatio = 1 - followedRatio;

  // Interest-based content filters
  let interestFilters = {};
  if (userProfile.interests.length > 0) {
    const interestRegex = userProfile.interests.map(
      (interest) => new RegExp(interest, "i")
    );
    interestFilters = {
      $or: [
        { status: { $in: interestRegex } },
        { type: { $in: userProfile.interests } },
      ],
    };
  }

  const [followedContent, discoveryContent, interestContent] =
    await Promise.all([
      // Content from followed users
      Content.find({
        ...baseFilters,
        "author.email": { $in: userProfile.followingEmails.slice(0, 100) },
      })
        .sort({ createdAt: -1, views: -1 })
        .limit(Math.ceil(fetchLimit * followedRatio))
        .lean(),

      // Discovery content (trending + random)
      Content.find({
        ...baseFilters,
        "author.email": { $nin: userProfile.followingEmails },
      })
        .sort({ views: -1, createdAt: -1 })
        .limit(Math.ceil(fetchLimit * discoveryRatio * 0.7))
        .lean(),

      // Interest-based content
      userProfile.interests.length > 0
        ? Content.find({
            ...baseFilters,
            ...interestFilters,
          })
            .sort({ createdAt: -1 })
            .limit(Math.ceil(fetchLimit * discoveryRatio * 0.3))
            .lean()
        : Promise.resolve([]),
    ]);

  // Combine and deduplicate
  const combined = [
    ...followedContent,
    ...discoveryContent,
    ...interestContent,
  ];
  const seen = new Set();
  const deduplicated = combined.filter((item) => {
    const id = item._id.toString();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Score content based on user profile
  const scoredContent = deduplicated.map((content) => ({
    ...content,
    relevanceScore: calculateContentRelevanceScore(content, userProfile),
    randomScore: Math.random(),
  }));

  // Sort by combined relevance and randomness
  const finalContent = scoredContent.sort((a, b) => {
    const scoreA = a.relevanceScore * 0.6 + a.randomScore * 0.4;
    const scoreB = b.relevanceScore * 0.6 + b.randomScore * 0.4;
    return scoreB - scoreA;
  });

  return shuffleArray(finalContent);
};

// Enrich content with engagement data and user context
const enrichContentWithEngagement = async (
  contents,
  userEmail,
  userProfile
) => {
  if (!contents.length) return [];

  const contentIds = contents.map((c) => c._id.toString());

  const [likesData, commentsData, sharesData, userLikes, userComments] =
    await Promise.all([
      Like.aggregate([
        { $match: { uid: { $in: contentIds }, type: "content" } },
        { $group: { _id: "$uid", count: { $sum: 1 } } },
      ]),
      Comment.aggregate([
        { $match: { uid: { $in: contentIds }, type: "content" } },
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
  const sharesMap = new Map(sharesData.map((item) => [item._id, item.count]));
  const userLikesSet = new Set(userLikes.map((like) => like.uid));
  const userCommentsSet = new Set(userComments.map((comment) => comment.uid));

  return contents.map((content) => {
    const contentId = content._id.toString();
    const likes = likesMap.get(contentId) || 0;
    const comments = commentsMap.get(contentId) || 0;
    const shares = sharesMap.get(contentId) || 0;
    const views = content.views || 0;

    return {
      ...content,
      contentType: determineContentType(content.files),
      engagement: {
        likes,
        comments,
        shares,
        views,
        liked: userLikesSet.has(contentId),
        commented: userCommentsSet.has(contentId),
        engagementScore: calculateEngagementScore(
          likes,
          comments,
          views,
          shares
        ),
      },
      personalization: {
        relevanceScore: content.relevanceScore || 0,
        isFromFollowing: userProfile.followingEmails.includes(
          content.author.email
        ),
        matchesInterests: userProfile.interests.some((interest) =>
          (content.status || "").toLowerCase().includes(interest.toLowerCase())
        ),
        previouslyInteracted: userProfile.interactionHistory.has(contentId),
      },
      randomScore: content.randomScore || Math.random(),
    };
  });
};

// Main enhanced randomized feed endpoint
const GetRandomizedFeed = async (req, res) => {
  try {
    const {
      cursor = null,
      limit = 20,
      contentType = "all",
      clearCache = "false",
      personalized = "true",
    } = req.query;

    const user = req.user;
    const userId = user._id;
    const userEmail = user.email;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50);
    const shouldClearCache = clearCache === "true";
    const usePersonalization = personalized === "true";

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

    // Clear seen content if requested
    let seenContent;
    if (shouldClearCache) {
      seenContent = clearSeenContent(userId);
      randomizedFeedCache.flushAll();
      userProfileCache.del(`user_profile_${userId}`);
    } else {
      seenContent = getSeenContent(userId);
    }

    // Get comprehensive user profile
    const userProfile = usePersonalization
      ? await getUserProfile(userId, userEmail)
      : {
          followingEmails: [],
          followingIds: [],
          interactionHistory: new Set(),
          interests: [],
          engagementStyle: "casual",
        };

    // Prepare exclusion list
    const excludeIds = Array.from(seenContent);

    // Fetch personalized content
    const fetchedContent = await fetchPersonalizedRandomContent(
      userId,
      userProfile,
      excludeIds,
      limitNum,
      cursor,
      contentType
    );

    // Enrich with engagement data and user context
    const enrichedContent = await enrichContentWithEngagement(
      fetchedContent,
      userEmail,
      userProfile
    );

    // Apply final randomization with personalization weights
    const finalRandomizedContent = shuffleArray(
      enrichedContent.map((item) => ({
        ...item,
        finalScore: usePersonalization
          ? item.personalization.relevanceScore * 0.4 +
            (item.engagement.engagementScore / 10) * 0.3 +
            item.randomScore * 0.3
          : item.randomScore * 0.7 +
            (item.engagement.engagementScore / 10) * 0.3,
      }))
    ).sort((a, b) => b.finalScore - a.finalScore);

    // Separate video and normal content
    const videoContent = [];
    const normalContent = [];

    finalRandomizedContent.forEach((item) => {
      if (item.contentType === "video") {
        videoContent.push(item);
      } else {
        normalContent.push(item);
      }
    });

    // Apply final limit while maintaining ratio
    const videoRatio =
      userProfile.contentTypePreferences?.video > 0.5 ? 0.6 : 0.4;
    const maxVideos = Math.ceil(limitNum * videoRatio);
    const maxNormal = limitNum - maxVideos;

    const finalVideoContent = shuffleArray(videoContent).slice(0, maxVideos);
    const finalNormalContent = shuffleArray(normalContent).slice(0, maxNormal);

    // Fill remaining slots if needed
    const totalReturned = finalVideoContent.length + finalNormalContent.length;
    if (totalReturned < limitNum) {
      const remaining = limitNum - totalReturned;
      if (
        finalVideoContent.length < maxVideos &&
        videoContent.length > finalVideoContent.length
      ) {
        finalVideoContent.push(
          ...videoContent.slice(
            finalVideoContent.length,
            finalVideoContent.length + remaining
          )
        );
      } else if (
        finalNormalContent.length < maxNormal &&
        normalContent.length > finalNormalContent.length
      ) {
        finalNormalContent.push(
          ...normalContent.slice(
            finalNormalContent.length,
            finalNormalContent.length + remaining
          )
        );
      }
    }

    // Track seen content
    const newContentIds = [
      ...finalVideoContent.map((item) => item._id.toString()),
      ...finalNormalContent.map((item) => item._id.toString()),
    ];
    const updatedSeenContent = trackSeenContent(userId, newContentIds);

    // Determine if there's more content
    const hasMore = fetchedContent.length >= limitNum * 2;
    const nextCursor =
      hasMore && finalRandomizedContent.length > 0
        ? finalRandomizedContent[finalRandomizedContent.length - 1]._id
        : null;

    // Prepare response with enhanced metrics
    const response = {
      normalContent: finalNormalContent.map((item, index) => ({
        ...item,
        feedPosition: index,
        loadPriority: item.engagement.engagementScore > 5 ? "high" : "normal",
      })),
      videoContent: finalVideoContent.map((item, index) => ({
        ...item,
        feedPosition: index,
        loadPriority: item.engagement.engagementScore > 5 ? "high" : "normal",
        autoplay: index < 3,
      })),
      hasMore,
      nextCursor,
      totalLoaded: finalVideoContent.length + finalNormalContent.length,
      contentType,
      randomized: true,
      personalized: usePersonalization,
      seenCount: updatedSeenContent.size,
      userProfile: usePersonalization
        ? {
            interests: userProfile.interests,
            engagementStyle: userProfile.engagementStyle,
            followingCount: userProfile.followingEmails.length,
            accountAge: Math.floor(
              userProfile.accountAge / (24 * 60 * 60 * 1000)
            ), // days
            userLevel: userProfile.userLevel,
            contentTypePreferences: userProfile.contentTypePreferences,
          }
        : null,
      metrics: {
        fetchedCount: fetchedContent.length,
        requestedLimit: limitNum,
        actualReturned: finalVideoContent.length + finalNormalContent.length,
        videoCount: finalVideoContent.length,
        normalCount: finalNormalContent.length,
        shuffleApplied: true,
        personalizationApplied: usePersonalization,
        cacheCleared: shouldClearCache,
        followedContentCount: enrichedContent.filter((item) =>
          userProfile.followingEmails.includes(item.author.email)
        ).length,
        interestMatchedCount: usePersonalization
          ? enrichedContent.filter(
              (item) => item.personalization.matchesInterests
            ).length
          : 0,
        discoveryContentCount: enrichedContent.filter(
          (item) => !userProfile.followingEmails.includes(item.author.email)
        ).length,
      },
    };

    return res
      .status(200)
      .json(
        GenRes(
          200,
          response,
          null,
          `Loaded ${response.totalLoaded} ${
            usePersonalization ? "personalized " : ""
          }randomized content items (${response.metrics.videoCount} videos, ${
            response.metrics.normalCount
          } normal)`
        )
      );
  } catch (error) {
    console.error("GetRandomizedFeed error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Clear user's seen content cache
const ClearSeenContent = async (req, res) => {
  try {
    const userId = req.user._id;
    clearSeenContent(userId);
    randomizedFeedCache.flushAll();
    userProfileCache.del(`user_profile_${userId}`);

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { cleared: true, seenCount: 0 },
          null,
          "Seen content cache cleared successfully"
        )
      );
  } catch (error) {
    console.error("ClearSeenContent error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's seen content statistics
const GetSeenContentStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const seenContent = getSeenContent(userId);
    const userProfile = await getUserProfile(userId, req.user.email);

    return res.status(200).json(
      GenRes(
        200,
        {
          seenCount: seenContent.size,
          canClear: seenContent.size > 0,
          userProfile: {
            interests: userProfile.interests,
            engagementStyle: userProfile.engagementStyle,
            followingCount: userProfile.followingEmails.length,
            contentTypePreferences: userProfile.contentTypePreferences,
            accountAge: Math.floor(
              userProfile.accountAge / (24 * 60 * 60 * 1000)
            ),
            userLevel: userProfile.userLevel,
          },
        },
        null,
        "Seen content statistics and user profile retrieved"
      )
    );
  } catch (error) {
    console.error("GetSeenContentStats error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Update user interests for better personalization
const UpdateUserInterests = async (req, res) => {
  try {
    const userId = req.user._id;
    const { interests } = req.body;

    if (!Array.isArray(interests)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Interests must be an array" },
            "Invalid interests format"
          )
        );
    }

    // Update user interests
    await User.findByIdAndUpdate(
      userId,
      { $set: { interests: interests.slice(0, 10) } }, // Limit to 10 interests
      { new: true }
    );

    // Clear user profile cache to refresh personalization
    userProfileCache.del(`user_profile_${userId}`);

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { interests: interests.slice(0, 10) },
          null,
          "User interests updated successfully"
        )
      );
  } catch (error) {
    console.error("UpdateUserInterests error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  GetRandomizedFeed,
  ClearSeenContent,
  GetSeenContentStats,
  UpdateUserInterests,
};
