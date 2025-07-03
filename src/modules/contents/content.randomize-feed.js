const Content = require("./contents.model");
const User = require("../user/user.model");
const Follow = require("../follow/follow.model");
const Like = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const NodeCache = require("node-cache");

// Cache for randomized feed optimization
const randomizedFeedCache = new NodeCache({ stdTTL: 300 });
const userSeenCache = new NodeCache({ stdTTL: 7200 });
const contentPoolCache = new NodeCache({ stdTTL: 600 });

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

// Advanced Fisher-Yates shuffle with weighted randomization
const shuffleArray = (array, weights = null) => {
  const shuffled = [...array];

  if (weights && weights.length === array.length) {
    // Weighted shuffle - items with higher weights more likely to appear first
    for (let i = shuffled.length - 1; i > 0; i--) {
      const weightSum = weights.slice(0, i + 1).reduce((a, b) => a + b, 0);
      let random = Math.random() * weightSum;
      let j = 0;

      while (random > weights[j] && j < i) {
        random -= weights[j];
        j++;
      }

      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      [weights[i], weights[j]] = [weights[j], weights[i]];
    }
  } else {
    // Standard Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }

  return shuffled;
};

// Track seen content with rotation strategy
const trackSeenContent = (userId, contentIds) => {
  const key = `seen_content_${userId}`;
  const seenContent = userSeenCache.get(key) || new Set();

  contentIds.forEach((id) => seenContent.add(id.toString()));

  // If seen content gets too large, keep only recent 50% to allow rotation
  if (seenContent.size > 1000) {
    const seenArray = Array.from(seenContent);
    const keepCount = Math.floor(seenArray.length * 0.5);
    const recentSeen = new Set(seenArray.slice(-keepCount));
    userSeenCache.set(key, recentSeen);
    return recentSeen;
  }

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

// Calculate dynamic engagement score with time decay
const calculateEngagementScore = (
  likes,
  comments,
  views,
  shares = 0,
  createdAt
) => {
  const baseEngagement = likes * 1 + comments * 3 + shares * 5 + views * 0.1;

  // Time decay factor - newer content gets slight boost
  const ageInHours =
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  const timeFactor = Math.max(0.1, 1 / (1 + ageInHours * 0.01));

  return Math.min((baseEngagement * timeFactor) / 100, 10);
};

// Get comprehensive user profile with preferences and social context
const getUserProfileAndContext = async (userId, userEmail) => {
  const cacheKey = `user_profile_context_${userId}`;
  const cached = randomizedFeedCache.get(cacheKey);
  if (cached) return cached;

  // Get user details from User model
  const [userProfile, following, followers, recentLikes, recentComments] =
    await Promise.all([
      User.findById(userId)
        .select(
          "interests level profession education location gender bio level createdAt"
        )
        .lean(),
      Follow.find({ "follower._id": userId })
        .select("following.email following._id following.name")
        .limit(200)
        .lean(),
      Follow.find({ "following._id": userId })
        .select("follower.email follower._id follower.name")
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

  // Build comprehensive user context
  const context = {
    // User profile data
    userProfile: userProfile || {},
    interests: userProfile?.interests || [],
    profession: userProfile?.profession || "",
    education: userProfile?.education || "",
    location: userProfile?.location || "",
    level: userProfile?.level || "bronze",
    accountAge: userProfile?.createdAt
      ? Math.floor(
          (Date.now() - new Date(userProfile.createdAt).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 0,

    // Social context
    followingEmails: following.map((f) => f.following.email),
    followingIds: following.map((f) => f.following._id),
    followingNames: following.map((f) => f.following.name),
    followerCount: followers.length,
    followingCount: following.length,

    // Engagement patterns
    recentLikedContent: recentLikes.map((l) => l.uid),
    recentCommentedContent: recentComments.map((c) => c.uid),
    interactionHistory: new Set([
      ...recentLikes.map((l) => l.uid),
      ...recentComments.map((c) => c.uid),
    ]),

    // Content preferences based on interactions
    preferredContentTypes: extractContentTypePreferences(
      recentLikes,
      recentComments
    ),
    preferredAuthors: extractPreferredAuthors(recentLikes, recentComments),
    engagementPattern: analyzeEngagementPattern(recentLikes, recentComments),

    // Activity patterns
    activeHours: calculateActiveHours(recentLikes, recentComments),
    engagementFrequency: calculateEngagementFrequency(
      recentLikes,
      recentComments
    ),
  };

  randomizedFeedCache.set(cacheKey, context);
  return context;
};

// Extract content type preferences from user interactions
const extractContentTypePreferences = (likes, comments) => {
  const typeCount = {};
  [...likes, ...comments].forEach((activity) => {
    typeCount[activity.type] = (typeCount[activity.type] || 0) + 1;
  });

  return Object.entries(typeCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([type]) => type);
};

// Extract preferred authors from user interactions
const extractPreferredAuthors = (likes, comments) => {
  const authorCount = {};
  [...likes, ...comments].forEach((activity) => {
    if (activity.author?.email) {
      authorCount[activity.author.email] =
        (authorCount[activity.author.email] || 0) + 1;
    }
  });

  return Object.entries(authorCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([email]) => email);
};

// Analyze user engagement patterns
const analyzeEngagementPattern = (likes, comments) => {
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
    hourlyPattern: hourlyActivity,
    dailyPattern: dailyActivity,
    totalInteractions: likes.length + comments.length,
    likeToCommentRatio: likes.length / Math.max(comments.length, 1),
  };
};

// Calculate user's active hours
const calculateActiveHours = (likes, comments) => {
  const hourlyActivity = new Array(24).fill(0);
  [...likes, ...comments].forEach((activity) => {
    const hour = new Date(activity.createdAt).getHours();
    hourlyActivity[hour]++;
  });

  const maxActivity = Math.max(...hourlyActivity);
  return hourlyActivity.map((count) =>
    maxActivity > 0 ? count / maxActivity : 0
  );
};

// Calculate engagement frequency
const calculateEngagementFrequency = (likes, comments) => {
  const totalInteractions = likes.length + comments.length;
  const daysSinceFirstInteraction =
    likes.length > 0 || comments.length > 0
      ? Math.max(
          1,
          Math.floor(
            (Date.now() -
              new Date(
                Math.min(
                  ...[...likes, ...comments].map((a) =>
                    new Date(a.createdAt).getTime()
                  )
                )
              ).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : 1;

  return totalInteractions / daysSinceFirstInteraction;
};

// Build comprehensive content pool with user preferences
const buildContentPool = async (userId, userContext, contentType) => {
  const cacheKey = `content_pool_${userId}_${contentType}`;
  const cached = contentPoolCache.get(cacheKey);
  if (cached) return cached;

  // Build filters for content type
  let typeFilters = {};

  if (contentType === "video") {
    typeFilters.$expr = {
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
    typeFilters.$expr = {
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

  // Build interest-based filters
  const interestFilters = {};
  if (userContext.interests?.length > 0) {
    const interestRegex = userContext.interests.map(
      (interest) =>
        new RegExp(interest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    );
    interestFilters.$or = [
      { status: { $in: interestRegex } },
      { type: { $in: userContext.interests.map((i) => i.toLowerCase()) } },
    ];
  }

  // Build profession-based filters
  const professionFilters = {};
  if (userContext.profession) {
    const professionRegex = new RegExp(
      userContext.profession.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );
    professionFilters.status = professionRegex;
  }

  // Build location-based filters
  const locationFilters = {};
  if (userContext.location) {
    const locationRegex = new RegExp(
      userContext.location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );
    locationFilters.status = locationRegex;
  }

  // Fetch comprehensive content pool with user preferences
  const [
    followedContent,
    trendingContent,
    recentContent,
    interestBasedContent,
    professionBasedContent,
    locationBasedContent,
    randomContent,
  ] = await Promise.all([
    // Content from followed users (35%)
    Content.find({
      ...typeFilters,
      "author.email": { $in: userContext.followingEmails.slice(0, 100) },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),

    // Trending content (20%)
    Content.find({
      ...typeFilters,
      views: { $gte: 100 },
    })
      .sort({ views: -1, createdAt: -1 })
      .limit(150)
      .lean(),

    // Recent content (15%)
    Content.find({
      ...typeFilters,
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),

    // Interest-based content (10%)
    userContext.interests?.length > 0
      ? Content.find({
          ...typeFilters,
          ...interestFilters,
        })
          .sort({ createdAt: -1 })
          .limit(80)
          .lean()
      : Promise.resolve([]),

    // Profession-based content (10%)
    userContext.profession
      ? Content.find({
          ...typeFilters,
          ...professionFilters,
        })
          .sort({ createdAt: -1 })
          .limit(60)
          .lean()
      : Promise.resolve([]),

    // Location-based content (5%)
    userContext.location
      ? Content.find({
          ...typeFilters,
          ...locationFilters,
        })
          .sort({ createdAt: -1 })
          .limit(40)
          .lean()
      : Promise.resolve([]),

    // Random older content (5%)
    Content.find({
      ...typeFilters,
      createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    })
      .sort({ _id: 1 })
      .limit(50)
      .lean(),
  ]);

  // Combine and deduplicate with preference scoring
  const combined = [
    ...followedContent.map((item) => ({ ...item, preferenceScore: 10 })),
    ...trendingContent.map((item) => ({ ...item, preferenceScore: 8 })),
    ...recentContent.map((item) => ({ ...item, preferenceScore: 7 })),
    ...interestBasedContent.map((item) => ({ ...item, preferenceScore: 9 })),
    ...professionBasedContent.map((item) => ({ ...item, preferenceScore: 8 })),
    ...locationBasedContent.map((item) => ({ ...item, preferenceScore: 6 })),
    ...randomContent.map((item) => ({ ...item, preferenceScore: 3 })),
  ];

  const seen = new Set();
  const contentPool = combined.filter((item) => {
    const id = item._id.toString();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  contentPoolCache.set(cacheKey, contentPool);
  return contentPool;
};

const generateInfiniteContent = async (
  userId,
  userContext,
  seenContent,
  limit,
  contentType,
  rotationCycle = 0
) => {
  // Get comprehensive content pool
  const contentPool = await buildContentPool(userId, userContext, contentType);

  if (contentPool.length === 0) {
    return [];
  }

  const seenRatio = seenContent.size / contentPool.length;

  let selectedContent = [];

  if (seenRatio < 0.3) {
    const unseenContent = contentPool.filter(
      (item) => !seenContent.has(item._id.toString())
    );
    selectedContent = unseenContent.sort(
      (a, b) => (b.preferenceScore || 0) - (a.preferenceScore || 0)
    );
  } else if (seenRatio < 0.7) {
    const unseenContent = contentPool.filter(
      (item) => !seenContent.has(item._id.toString())
    );
    const seenContentArray = contentPool.filter((item) =>
      seenContent.has(item._id.toString())
    );

    // Sort by preference score
    const sortedUnseen = unseenContent.sort(
      (a, b) => (b.preferenceScore || 0) - (a.preferenceScore || 0)
    );
    const sortedSeen = seenContentArray.sort(
      (a, b) => (b.preferenceScore || 0) - (a.preferenceScore || 0)
    );

    // 70% unseen, 30% seen (for variety)
    const unseenCount = Math.ceil(limit * 0.7);
    const seenCount = limit - unseenCount;

    selectedContent = [
      ...sortedUnseen.slice(0, unseenCount),
      ...shuffleArray(sortedSeen).slice(0, seenCount),
    ];
  } else {
    selectedContent = contentPool.sort((a, b) => {
      const preferenceWeight =
        (b.preferenceScore || 0) - (a.preferenceScore || 0);
      const randomWeight = Math.random() - 0.5;
      return preferenceWeight * 0.7 + randomWeight * 0.3;
    });
  }

  // Apply user-preference-aware randomization layers
  const randomizationLayers = [
    () => {
      const weights = selectedContent.map((item) => {
        let weight = item.preferenceScore || 1;

        // Boost content from preferred authors
        if (userContext.preferredAuthors?.includes(item.author.email)) {
          weight += 5;
        }

        // Boost content matching user interests
        if (
          userContext.interests?.some((interest) =>
            item.status?.toLowerCase().includes(interest.toLowerCase())
          )
        ) {
          weight += 3;
        }

        // Boost content matching user profession
        if (
          userContext.profession &&
          item.status
            ?.toLowerCase()
            .includes(userContext.profession.toLowerCase())
        ) {
          weight += 2;
        }

        return weight + Math.random();
      });
      return shuffleArray(selectedContent, weights);
    },

    // Layer 2: Engagement-weighted shuffle with user pattern
    () => {
      const weights = selectedContent.map((item) => {
        const likes = Math.random() * 100;
        const comments = Math.random() * 50;
        const views = item.views || Math.random() * 1000;
        const engagementScore = calculateEngagementScore(
          likes,
          comments,
          views,
          0,
          item.createdAt
        );

        // Adjust based on user's engagement pattern
        const userEngagementBoost =
          userContext.engagementPattern?.likeToCommentRatio > 2
            ? likes * 0.1
            : comments * 0.2;

        return engagementScore + userEngagementBoost + Math.random();
      });
      return shuffleArray(selectedContent, weights);
    },

    // Layer 3: Time-based rotation with user activity pattern
    () => {
      const currentHour = new Date().getHours();
      const userActiveNow = userContext.activeHours?.[currentHour] > 0.5;

      const timeGroups = {
        recent: [],
        medium: [],
        old: [],
      };

      const now = Date.now();
      selectedContent.forEach((item) => {
        const age = now - new Date(item.createdAt).getTime();
        const ageInDays = age / (1000 * 60 * 60 * 24);

        // Boost recent content if user is active now
        const timeBoost = userActiveNow && ageInDays < 1 ? 2 : 1;
        item.timeBoost = timeBoost;

        if (ageInDays < 7) timeGroups.recent.push(item);
        else if (ageInDays < 30) timeGroups.medium.push(item);
        else timeGroups.old.push(item);
      });

      return shuffleArray([
        ...shuffleArray(timeGroups.recent),
        ...shuffleArray(timeGroups.medium),
        ...shuffleArray(timeGroups.old),
      ]);
    },

    // Layer 4: Author diversity shuffle with user following pattern
    () => {
      const authorGroups = {};
      selectedContent.forEach((item) => {
        const authorEmail = item.author.email;
        if (!authorGroups[authorEmail]) authorGroups[authorEmail] = [];
        authorGroups[authorEmail].push(item);
      });

      // Prioritize followed authors but maintain diversity
      const followedAuthors = Object.keys(authorGroups).filter((email) =>
        userContext.followingEmails.includes(email)
      );
      const otherAuthors = Object.keys(authorGroups).filter(
        (email) => !userContext.followingEmails.includes(email)
      );

      // Interleave content: 60% followed, 40% others
      const result = [];
      const maxLength = Math.max(
        ...Object.values(authorGroups).map((arr) => arr.length)
      );

      for (let i = 0; i < maxLength; i++) {
        // Add from followed authors first
        shuffleArray(followedAuthors).forEach((authorEmail) => {
          if (authorGroups[authorEmail][i]) {
            result.push(authorGroups[authorEmail][i]);
          }
        });

        // Then add from other authors
        shuffleArray(otherAuthors).forEach((authorEmail) => {
          if (authorGroups[authorEmail][i] && result.length < limit * 2) {
            result.push(authorGroups[authorEmail][i]);
          }
        });
      }

      return result;
    },
  ];

  // Apply random layer based on rotation cycle
  const layerIndex = rotationCycle % randomizationLayers.length;
  const randomizedContent = randomizationLayers[layerIndex]();

  // Add user-specific scoring
  return randomizedContent.slice(0, limit * 2).map((item) => ({
    ...item,
    randomSeed: Math.random(),
    rotationCycle,
    layerUsed: layerIndex,
    userRelevanceScore: calculateUserRelevanceScore(item, userContext),
  }));
};

// Calculate user relevance score based on profile and preferences
const calculateUserRelevanceScore = (content, userContext) => {
  let score = 0.5;

  // Following relationship boost
  if (userContext.followingEmails.includes(content.author.email)) {
    score += 0.3;
  }

  // Interest matching boost
  if (
    userContext.interests?.some((interest) =>
      content.status?.toLowerCase().includes(interest.toLowerCase())
    )
  ) {
    score += 0.2;
  }

  // Profession matching boost
  if (
    userContext.profession &&
    content.status?.toLowerCase().includes(userContext.profession.toLowerCase())
  ) {
    score += 0.15;
  }

  // Location matching boost
  if (
    userContext.location &&
    content.status?.toLowerCase().includes(userContext.location.toLowerCase())
  ) {
    score += 0.1;
  }

  // Preferred author boost
  if (userContext.preferredAuthors?.includes(content.author.email)) {
    score += 0.25;
  }

  // Content type preference boost
  if (userContext.preferredContentTypes?.includes(content.type)) {
    score += 0.15;
  }

  // Account level boost (more experienced users get diverse content)
  if (userContext.level === "gold" || userContext.level === "platinum") {
    score += 0.05;
  }

  return Math.min(score, 1);
};

// Enrich content with engagement data
const enrichContentWithEngagement = async (contents, userEmail) => {
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
          shares,
          content.createdAt
        ),
      },
      infiniteScore:
        (content.randomSeed || Math.random()) * 0.4 +
        (content.userRelevanceScore || 0.5) * 0.6,
    };
  });
};

const enrichContentWithFollowStatus = (contents, userContext) => {
  const followingEmails = new Set(userContext.followingEmails || []);
  const followingIds = new Set(
    userContext.followingIds?.map((id) => id.toString()) || []
  );

  return contents.map((content) => ({
    ...content,
    author: {
      ...content.author,
      isFollowed:
        followingEmails.has(content.author.email) ||
        followingIds.has(content.author._id?.toString()),
      followStatus:
        followingEmails.has(content.author.email) ||
        followingIds.has(content.author._id?.toString())
          ? "following"
          : "not_following",
    },
  }));
};

// Main infinite randomized feed endpoint
const GetRandomizedFeed = async (req, res) => {
  try {
    const {
      cursor = null,
      limit = 20,
      contentType = "all",
      clearCache = "false",
      rotationCycle = 0,
    } = req.query;

    const user = req.user;
    const userId = user._id;
    const userEmail = user.email;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 50);
    const shouldClearCache = clearCache === "true";
    const currentRotationCycle = parseInt(rotationCycle, 10) || 0;

    // Clear seen content if requested
    let seenContent;
    if (shouldClearCache) {
      seenContent = clearSeenContent(userId);
      randomizedFeedCache.flushAll();
      contentPoolCache.flushAll();
    } else {
      seenContent = getSeenContent(userId);
    }

    // Get comprehensive user profile and context
    const userContext = await getUserProfileAndContext(userId, userEmail);

    // Generate infinite content with user preferences
    const fetchedContent = await generateInfiniteContent(
      userId,
      userContext,
      seenContent,
      limitNum,
      contentType,
      currentRotationCycle
    );

    // Enrich with engagement data
    const enrichedContent = await enrichContentWithEngagement(
      fetchedContent,
      userEmail
    );

    const contentWithFollowStatus = enrichContentWithFollowStatus(
      enrichedContent,
      userContext
    );

    // Final randomization with user relevance scoring
    const finalRandomizedContent = shuffleArray(
      contentWithFollowStatus.map((item) => ({
        ...item,
        finalInfiniteScore:
          item.infiniteScore * 0.6 +
          (item.engagement.engagementScore / 10) * 0.2 +
          ((item.preferenceScore || 0) / 10) * 0.2,
      }))
    ).sort((a, b) => b.finalInfiniteScore - a.finalInfiniteScore);

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

    // Apply content ratio (40% videos, 60% normal)
    const videoRatio = 0.4;
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

    // Track seen content (with rotation management)
    const newContentIds = [
      ...finalVideoContent.map((item) => item._id.toString()),
      ...finalNormalContent.map((item) => item._id.toString()),
    ];
    const updatedSeenContent = trackSeenContent(userId, newContentIds);

    const hasMore = true;
    const nextCursor = `infinite_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const contentPool = await buildContentPool(
      userId,
      userContext,
      contentType
    );
    const seenRatio = updatedSeenContent.size / Math.max(contentPool.length, 1);

    const response = {
      normalContent: finalNormalContent.map((item, index) => ({
        ...item,
        feedPosition: index,
        loadPriority: item.engagement.engagementScore > 5 ? "high" : "normal",
        isResurfaced: seenContent.has(item._id.toString()),
        userRelevance: item.userRelevanceScore || 0.5,
      })),
      videoContent: finalVideoContent.map((item, index) => ({
        ...item,
        feedPosition: index,
        loadPriority: item.engagement.engagementScore > 5 ? "high" : "normal",
        autoplay: index < 3,
        isResurfaced: seenContent.has(item._id.toString()),
        userRelevance: item.userRelevanceScore || 0.5,
      })),
      hasMore,
      nextCursor,
      totalLoaded: finalVideoContent.length + finalNormalContent.length,
      contentType,
      randomized: true,
      seenCount: updatedSeenContent.size,
      metrics: {
        fetchedCount: fetchedContent.length,
        requestedLimit: limitNum,
        actualReturned: finalVideoContent.length + finalNormalContent.length,
        videoCount: finalVideoContent.length,
        normalCount: finalNormalContent.length,
        shuffleApplied: true,
        cacheCleared: shouldClearCache,
        followedContentRatio: Math.round(
          (enrichedContent.filter((item) =>
            userContext.followingEmails.includes(item.author.email)
          ).length /
            Math.max(enrichedContent.length, 1)) *
            100
        ),
        discoveryContentRatio: Math.round(
          (enrichedContent.filter(
            (item) => !userContext.followingEmails.includes(item.author.email)
          ).length /
            Math.max(enrichedContent.length, 1)) *
            100
        ),
        contentPoolSize: contentPool.length,
        seenRatio: Math.round(seenRatio * 100),
        rotationCycle: currentRotationCycle,
        infiniteMode: true,
        resurfacedCount: newContentIds.filter((id) => seenContent.has(id))
          .length,
        userPersonalization: {
          interestsMatched: userContext.interests?.length || 0,
          professionMatched: !!userContext.profession,
          locationMatched: !!userContext.location,
          followingCount: userContext.followingCount,
          accountLevel: userContext.level,
          accountAge: userContext.accountAge,
        },
      },
    };

    return res
      .status(200)
      .json(
        GenRes(
          200,
          response,
          null,
          `Loaded ${response.totalLoaded} personalized randomized content items (${response.metrics.videoCount} videos, ${response.metrics.normalCount} normal) - Infinite Mode`
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
    contentPoolCache.flushAll();

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { cleared: true, seenCount: 0, infiniteMode: true },
          null,
          "Seen content cache cleared - Infinite feed reset"
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
    const userEmail = req.user.email;
    const seenContent = getSeenContent(userId);
    const userContext = await getUserProfileAndContext(userId, userEmail);
    const contentPool = await buildContentPool(userId, userContext, "all");

    const seenRatio = seenContent.size / Math.max(contentPool.length, 1);

    return res.status(200).json(
      GenRes(
        200,
        {
          seenCount: seenContent.size,
          totalContentPool: contentPool.length,
          seenRatio: Math.round(seenRatio * 100),
          infiniteMode: true,
          rotationActive: seenRatio > 0.7,
          canClear: seenContent.size > 0,
          userProfile: {
            interests: userContext.interests,
            profession: userContext.profession,
            location: userContext.location,
            followingCount: userContext.followingCount,
            level: userContext.level,
            accountAge: userContext.accountAge,
          },
        },
        null,
        "Infinite feed statistics with user profile retrieved"
      )
    );
  } catch (error) {
    console.error("GetSeenContentStats error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  GetRandomizedFeed,
  ClearSeenContent,
  GetSeenContentStats,
};
