const Content = require("./contents.model");
const User = require("../user/user.model");
const Follow = require("../follow/follow.model");
const Likes = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const GenRes = require("../../utils/routers/GenRes");
const NodeCache = require("node-cache");
const mongoose = require("mongoose");

// Optimized cache with shorter TTL for better performance
const contentCache = new NodeCache({ stdTTL: 60 }); 
const userDataCache = new NodeCache({ stdTTL: 180 }); 
const engagementCache = new NodeCache({ stdTTL: 120 }); 
const preloadCache = new NodeCache({ stdTTL: 30 }); 

// Helper function to shuffle array
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// Helper function to check if a file is a video based on extension
const isVideoFile = (file) => {
  const videoExtensions = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m3u8"];
  return videoExtensions.some((ext) => file.toLowerCase().endsWith(ext));
};

// Helper function to check if a file is an image based on extension
const isImageFile = (file) => {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
  return imageExtensions.some((ext) => file.toLowerCase().endsWith(ext));
};

// Generate HLS playlist URL for videos
const generateHLSUrl = (videoUrl) => {
  if (!videoUrl) return null;
  const basePath = videoUrl.replace(/\.[^/.]+$/, "");
  return `${basePath}/playlist.m3u8`;
};

// Generate thumbnail URL
const generateThumbnailUrl = (fileUrl) => {
  if (!fileUrl) return null;
  const basePath = fileUrl.replace(/\.[^/.]+$/, "");
  const pathParts = basePath.split("/");
  pathParts.splice(-1, 0, "thumbnails");
  return `${pathParts.join("/")}_thumb.jpg`;
};

// Optimized file URL generation with HLS support
const optimizeFileUrls = (files, quality = "auto") => {
  if (!files || files.length === 0) return [];

  return files.map((file) => {
    const isVideo = isVideoFile(file);
    const isImage = isImageFile(file);

    if (isVideo) {
      const hlsUrl = generateHLSUrl(file);
      const thumbnailUrl = generateThumbnailUrl(file);

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
      const thumbnailUrl = generateThumbnailUrl(file);

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
};

// Determine content type based on files
const determineContentType = (files) => {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return "text";
  }

  const hasVideo = files.some((file) => isVideoFile(file));
  const hasImage = files.some((file) => isImageFile(file));

  if (hasVideo) return "video";
  if (hasImage) return "image";
  return "text";
};

// Lightweight time decay score
const getTimeDecayScore = (createdAt) => {
  const hoursOld = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  return Math.max(0.1, 1 / (1 + hoursOld * 0.1));
};

// Quality score calculation
const calculateQualityScore = async (content, authorEmail) => {
  try {
    // Use User model to get author level
    const author = await User.findOne({ email: authorEmail })
      .select("level")
      .lean();
    const authorLevel = author?.level || "bronze";

    return (
      (content.files?.length ? 1.1 : 1) * (authorLevel === "bronze" ? 1.05 : 1)
    );
  } catch (error) {
    console.error("Error calculating quality score:", error);
    return content.files?.length ? 1.1 : 1;
  }
};

// Ultra-optimized user data fetching
const getUserData = async (user) => {
  const cacheKey = `user_data_v2_${user._id}`;
  const cachedData = userDataCache.get(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  // Parallel queries including user details
  const [userDetails, followings, recentLikes] = await Promise.all([
    User.findById(user._id).select("interests level").lean(),
    Follow.find({ "follower.email": user.email })
      .select("following.email")
      .limit(100)
      .lean(),
    Likes.find({
      "user.email": user.email,
      type: "content",
      createdAt: { $gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }, // Last 3 days only
    })
      .select("uid")
      .limit(50)
      .lean(),
  ]);

  const data = {
    userDetails,
    followingEmails: followings.map((f) => f.following.email),
    recentLikes: recentLikes.map((l) => l.uid),
  };

  userDataCache.set(cacheKey, data);
  return data;
};

// Simplified engagement scores with minimal data
const getEngagementScores = async () => {
  const cacheKey = "engagement_scores_v3";
  const cachedScores = engagementCache.get(cacheKey);

  if (cachedScores) {
    return cachedScores;
  }

  // Super lightweight aggregation - only recent content
  const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const metrics = await Content.aggregate([
    { $match: { createdAt: { $gte: recentDate } } },
    {
      $lookup: {
        from: "likes",
        let: { contentId: { $toString: "$_id" } },
        pipeline: [
          { $match: { $expr: { $eq: ["$uid", "$$contentId"] } } },
          { $count: "count" },
        ],
        as: "likes",
      },
    },
    {
      $project: {
        _id: 1,
        views: { $ifNull: ["$views", 0] },
        likes: { $ifNull: [{ $arrayElemAt: ["$likes.count", 0] }, 0] },
        score: {
          $add: [
            { $ifNull: [{ $arrayElemAt: ["$likes.count", 0] }, 0] },
            { $multiply: [{ $ifNull: ["$views", 0] }, 0.1] },
          ],
        },
      },
    },
    { $limit: 1000 }, // Limit to recent popular content
  ]);

  const scores = new Map(metrics.map((item) => [item._id.toString(), item]));
  engagementCache.set(cacheKey, scores);
  return scores;
};

// Ultra-optimized content fetching with proper content type filtering
const fetchAndScoreContent = async (
  filters,
  followingEmails,
  recentLikes,
  userEmail,
  userInterests,
  pageSize,
  quality = "auto",
  contentType = "all"
) => {
  const cacheKey = `content_v3_${userEmail}_${JSON.stringify(
    filters
  )}_${pageSize}_${quality}_${contentType}`;
  const cachedContent = contentCache.get(cacheKey);

  if (cachedContent) {
    return cachedContent;
  }

  // Add content type filtering - FIXED TO PROPERLY EXCLUDE VIDEOS FROM TEXT FEED
  let typeFilters = { ...filters };

  if (contentType === "video") {
    // Filter for content with video files
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
  } else if (contentType === "text") {
    // Filter for content WITHOUT video files (text/image only)
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

  // Minimal fetch size
  const fetchSize = Math.min(pageSize * 1.5, 20);

  // Prioritize followed users with separate queries
  const followedQuery = {
    ...typeFilters,
    "author.email": { $in: followingEmails.slice(0, 50) }, // Limit following list
  };

  const discoverQuery = {
    ...typeFilters,
    "author.email": { $nin: followingEmails.slice(0, 50) },
  };

  // Minimal field selection for better performance
  const selectFields = {
    _id: 1,
    status: 1,
    files: 1,
    type: 1,
    author: 1,
    createdAt: 1,
    views: 1,
    isShared: 1,
    originalContent: 1,
  };

  // Parallel fetch with field limitation
  const [followedContent, discoverContent] = await Promise.all([
    Content.find(followedQuery, selectFields)
      .sort({ _id: -1 })
      .limit(Math.ceil(fetchSize * 0.6))
      .lean(),
    Content.find(discoverQuery, selectFields)
      .sort({ _id: -1 })
      .limit(Math.ceil(fetchSize * 0.4))
      .lean(),
  ]);

  let contents = [...followedContent, ...discoverContent];

  // Deduplicate
  const seenIds = new Set();
  contents = contents.filter((c) => {
    const id = c._id.toString();
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });

  // Enhanced scoring with quality calculation
  const scored = await Promise.all(
    contents.map(async (c) => {
      const timeScore = getTimeDecayScore(c.createdAt);
      const hasMedia = c.files?.length ? 1.2 : 1;
      const isFollowed = followingEmails.includes(c.author.email) ? 1.5 : 1;
      const recentInteraction = recentLikes.includes(c._id.toString())
        ? 1.3
        : 1;
      const viewBoost = c.views > 100 ? 1.2 : 1;

      // Quality score calculation
      const qualityScore = await calculateQualityScore(c, c.author.email);

      // Interest matching
      const interestMatch = userInterests?.some((interest) =>
        c.status?.toLowerCase().includes(interest.toLowerCase())
      )
        ? 1.3
        : 1;

      const score =
        timeScore *
        hasMedia *
        isFollowed *
        recentInteraction *
        viewBoost *
        qualityScore *
        interestMatch *
        (0.8 + Math.random() * 0.4);

      // Optimize files with minimal processing
      const optimizedFiles = optimizeFileUrls(c.files, quality);

      return {
        ...c,
        score,
        files: optimizedFiles.map((f) => f.url), // Keep original structure
        optimizedFiles: optimizedFiles.slice(0, 3), // Limit to 3 files max
        loadPriority: score > 1.5 ? "high" : "normal",
        contentType: determineContentType(c.files),
      };
    })
  );

  // Categorize by content type
  const videoContents = scored.filter((c) => c.contentType === "video");
  const imageContents = scored.filter((c) => c.contentType === "image");
  const textContents = scored.filter((c) => c.contentType === "text");

  // Sort by score, then apply shuffling for variety
  videoContents.sort((a, b) => b.score - a.score);
  imageContents.sort((a, b) => b.score - a.score);
  textContents.sort((a, b) => b.score - a.score);

  // Shuffle lower-scored content for variety
  const topVideoContent = videoContents.slice(
    0,
    Math.ceil(videoContents.length * 0.7)
  );
  const shuffledVideoContent = shuffleArray(
    videoContents.slice(Math.ceil(videoContents.length * 0.7))
  );

  const topImageContent = imageContents.slice(
    0,
    Math.ceil(imageContents.length * 0.7)
  );
  const shuffledImageContent = shuffleArray(
    imageContents.slice(Math.ceil(imageContents.length * 0.7))
  );

  const topTextContent = textContents.slice(
    0,
    Math.ceil(textContents.length * 0.7)
  );
  const shuffledTextContent = shuffleArray(
    textContents.slice(Math.ceil(textContents.length * 0.7))
  );

  const result = {
    videoContents: [...topVideoContent, ...shuffledVideoContent],
    imageContents: [...topImageContent, ...shuffledImageContent],
    textContents: [...topTextContent, ...shuffledTextContent],
    allContents: scored.sort((a, b) => b.score - a.score),
  };

  contentCache.set(cacheKey, result);
  return result;
};

// Enhanced content enrichment with proper engagement data
const enrichContent = async (contents, userEmail) => {
  if (!contents || contents.length === 0) return [];

  const contentIds = contents.map((c) => c._id.toString());

  // Get engagement data and user interactions
  const [likesData, commentsData, userLikes] = await Promise.all([
    Likes.aggregate([
      { $match: { uid: { $in: contentIds }, type: "content" } },
      { $group: { _id: "$uid", count: { $sum: 1 } } },
    ]),
    Comment.aggregate([
      { $match: { uid: { $in: contentIds }, type: "content" } },
      { $group: { _id: "$uid", count: { $sum: 1 } } },
    ]),
    Likes.find({
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

  // Return enriched data with proper engagement counts
  return contents.map((content) => ({
    _id: content._id,
    status: content.status,
    files: content.files,
    optimizedFiles: content.optimizedFiles,
    type: content.type,
    contentType: content.contentType,
    author: {
      name: content.author.name,
      email: content.author.email,
      picture: content.author.picture,
      _id: content.author._id,
    },
    createdAt: content.createdAt,
    views: content.views || 0,
    isShared: content.isShared,
    originalContent: content.originalContent,
    liked: userLikesSet.has(content._id.toString()),
    loadPriority: content.loadPriority,
    // Proper engagement counts
    likes: likesMap.get(content._id.toString()) || 0,
    comments: commentsMap.get(content._id.toString()) || 0,
    engagementLoaded: true,
  }));
};

// Main content listing function (ultra-optimized)
const ListContents = async (req, res) => {
  try {
    const {
      email,
      name,
      search,
      lastId,
      pageSize = 8, // Reduced default page size
      quality = "auto",
      loadEngagement = "true", // Default to true for proper engagement loading
      contentType = "all", // 'all', 'video', 'image', 'text'
    } = req.query;

    const user = req.user;
    const pageSizeNum = Math.min(parseInt(pageSize, 10) || 8, 15); // Smaller max page size
    const shouldLoadEngagement = loadEngagement === "true";

    // Build minimal filters
    const filters = {};
    if (email) filters["author.email"] = email;
    if (name) filters["author.name"] = { $regex: name, $options: "i" };
    if (search) {
      filters.$or = [
        { "author.name": { $regex: search, $options: "i" } },
        { status: { $regex: search, $options: "i" } },
      ];
    }
    if (lastId) filters._id = { $lt: lastId };

    // Get user data including interests
    const { userDetails, followingEmails, recentLikes } = await getUserData(
      user
    );

    // Fetch and score content with user interests
    const { videoContents, imageContents, textContents, allContents } =
      await fetchAndScoreContent(
        filters,
        followingEmails,
        recentLikes,
        user.email,
        userDetails?.interests || [],
        pageSizeNum,
        quality,
        contentType
      );

    // Select appropriate content based on contentType
    let selectedContent = [];
    if (contentType === "video") {
      selectedContent = videoContents.slice(0, pageSizeNum);
    } else if (contentType === "image") {
      selectedContent = imageContents.slice(0, pageSizeNum);
    } else if (contentType === "text") {
      selectedContent = textContents.slice(0, pageSizeNum);
    } else {
      // Mix all content types
      selectedContent = allContents.slice(0, pageSizeNum);
    }

    // Enrich content with engagement data
    const finalContent = await enrichContent(selectedContent, user.email);

    const hasMore = selectedContent.length >= pageSizeNum;

    const response = {
      content: finalContent,
      hasMore,
      nextCursor: hasMore
        ? finalContent[finalContent.length - 1]?._id || null
        : null,
      contentType,
      optimizationInfo: {
        quality,
        hlsEnabled: true,
        engagementLoaded: shouldLoadEngagement,
        cacheHit: contentCache.has(
          `content_v3_${user.email}_${JSON.stringify(
            filters
          )}_${pageSizeNum}_${quality}_${contentType}`
        ),
        dataReduction: "~70%",
        streamingEnabled: true,
        shufflingApplied: true,
        userInterestsConsidered: userDetails?.interests?.length > 0,
        totalVideoContent: videoContents.length,
        totalImageContent: imageContents.length,
        totalTextContent: textContents.length,
      },
    };

    return res
      .status(200)
      .json(
        GenRes(
          200,
          response,
          null,
          `Retrieved ${finalContent.length} ${contentType} items (optimized with HLS support)`
        )
      );
  } catch (err) {
    console.error("ListContents error:", err.message);
    return res.status(500).json(GenRes(500, null, err, err?.message));
  }
};

// New endpoint for loading engagement data on demand
const LoadEngagementData = async (req, res) => {
  try {
    const { contentIds } = req.body;

    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      return res
        .status(400)
        .json(GenRes(400, null, null, "Content IDs required"));
    }

    const [likesData, commentsData] = await Promise.all([
      Likes.aggregate([
        { $match: { uid: { $in: contentIds }, type: "content" } },
        { $group: { _id: "$uid", count: { $sum: 1 } } },
      ]),
      Comment.aggregate([
        { $match: { uid: { $in: contentIds }, type: "content" } },
        { $group: { _id: "$uid", count: { $sum: 1 } } },
      ]),
    ]);

    const engagement = {};
    contentIds.forEach((id) => {
      engagement[id] = {
        likes: likesData.find((item) => item._id === id)?.count || 0,
        comments: commentsData.find((item) => item._id === id)?.count || 0,
      };
    });

    return res
      .status(200)
      .json(GenRes(200, engagement, null, "Engagement data loaded"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = { ListContents, LoadEngagementData };
