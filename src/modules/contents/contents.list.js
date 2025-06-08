const Content = require("./contents.model");
const User = require("../user/user.model");
const Follow = require("../follow/follow.model");
const Likes = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const GenRes = require("../../utils/routers/GenRes");
const axios = require("axios");
const NodeCache = require("node-cache");
const mongoose = require("mongoose");

// Initialize cache with 5 minutes TTL
const contentCache = new NodeCache({ stdTTL: 300 });
const userDataCache = new NodeCache({ stdTTL: 300 });
const engagementCache = new NodeCache({ stdTTL: 300 });

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
  const videoExtensions = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
  return videoExtensions.some((ext) => file.toLowerCase().endsWith(ext));
};

// Helper function to check if a file is an image based on extension
const isImageFile = (file) => {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp"];
  return imageExtensions.some((ext) => file.toLowerCase().endsWith(ext));
};

// Time decay score calculation
const getTimeDecayScore = (createdAt) => {
  const hoursOld =
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  return 1 / (1 + Math.sqrt(Math.max(hoursOld, 0.1)));
};

// Quality score calculation
const calculateQualityScore = async (content) => {
  let score = content.files?.length ? 1.2 : 1;
  const author = await User.findOne({ email: content.author.email }).lean();
  if (author?.level === "bronze") score *= 1.1;
  return score;
};

// Fetch user data with caching
const getUserData = async (user) => {
  const cacheKey = `user_data_${user._id}`;
  const cachedData = userDataCache.get(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  const userDetails = await User.findById(user._id).lean();
  const followings = await Follow.find({ "follower.email": user.email });
  const followingEmails = followings.map((f) => f.following.email);
  const recentLikes = await Likes.find({
    "user.email": user.email,
    type: "content",
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  }).distinct("uid");
  const viewedContent = await Content.find({ viewedBy: user.email })
    .distinct("_id")
    .then((ids) => ids.map((id) => id.toString()));

  const data = { userDetails, followingEmails, recentLikes, viewedContent };
  userDataCache.set(cacheKey, data);
  return data;
};

// Fetch engagement metrics with caching
const getEngagementScores = async () => {
  const cacheKey = "engagement_scores";
  const cachedScores = engagementCache.get(cacheKey);

  if (cachedScores) {
    return cachedScores;
  }

  const metrics = await Content.aggregate([
    {
      $lookup: {
        from: "likes",
        localField: "_id",
        foreignField: "uid",
        as: "likes",
        pipeline: [{ $match: { type: "content" } }],
      },
    },
    {
      $lookup: {
        from: "comments",
        localField: "_id",
        foreignField: "uid",
        as: "comments",
        pipeline: [{ $match: { type: "content" } }],
      },
    },
    {
      $project: {
        _id: 1,
        views: 1,
        engagementScore: {
          $add: [
            { $multiply: [{ $size: "$likes" }, 1] },
            { $multiply: [{ $size: "$comments" }, 2] },
            { $multiply: [{ $ifNull: ["$views", 0] }, 0.1] },
          ],
        },
      },
    },
  ]);

  const scores = new Map(
    metrics.map((item) => [item._id.toString(), { ...item }])
  );
  engagementCache.set(cacheKey, scores);
  return scores;
};

const fetchAndScoreContent = async (
  filters,
  emails,
  viewedContent,
  engagementScores,
  userInterests,
  recentLikes,
  userEmail,
  pageSize,
  isRefresh
) => {
  const cacheKey = `content_${userEmail}_${JSON.stringify(
    filters
  )}_${pageSize}_${isRefresh}`;
  const cachedContent = contentCache.get(cacheKey);

  if (cachedContent && !isRefresh) {
    return cachedContent;
  }

  const fetchSize = pageSize * 4;

  // Validate viewedContent IDs
  const validObjectIds = viewedContent.filter((id) => {
    if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      console.warn(`Invalid ObjectId in viewedContent: ${id}`);
      return false;
    }
    return true;
  });

  const query = {
    ...filters,
    $or: [
      { "author.email": { $in: emails } },
      { "author.email": { $nin: emails } },
    ],
  };
  if (validObjectIds.length > 0) {
    query._id = {
      $nin: validObjectIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  // Fetch unseen content
  let contents = await Content.find(query)
    .sort({ _id: -1 })
    .limit(fetchSize)
    .lean();

  // Fetch viewed content if needed
  let viewedContents = [];
  if (contents.length < pageSize || isRefresh) {
    const validViewedObjectIds = viewedContent.filter((id) => {
      if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
        console.warn(`Invalid ObjectId in viewedContent for $in: ${id}`);
        return false;
      }
      return true;
    });
    viewedContents = await Content.find({
      ...query,
      _id: {
        $in: validViewedObjectIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    })
      .sort({ _id: -1 })
      .limit(fetchSize - contents.length)
      .lean();
  }

  // Deduplicate
  const seenIds = new Set();
  contents = [...contents, ...viewedContents].filter((c) => {
    const id = c._id.toString();
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });

  // Shuffle if all viewed
  if (
    contents.length > 0 &&
    contents.every((c) => viewedContent.includes(c._id.toString()))
  ) {
    contents = shuffleArray(contents);
  }

  const scored = await Promise.all(
    contents.map(async (c) => {
      const metrics = engagementScores.get(c._id.toString()) || {
        engagementScore: 0,
        views: 0,
      };
      const qualityScore = await calculateQualityScore(c);

      const features = {
        engagement_score: metrics.engagementScore,
        time_decay: getTimeDecayScore(c.createdAt),
        has_media: c.files?.length ? 1 : 0,
        is_bronze_author:
          (await User.findOne({ email: c.author.email }).lean())?.level ===
          "bronze"
            ? 1
            : 0,
        interest_match: userInterests.some((i) =>
          c.status?.toLowerCase().includes(i.toLowerCase())
        )
          ? 1
          : 0,
        is_following: emails.includes(c.author.email) ? 1 : 0,
        recent_interaction: recentLikes.includes(c._id.toString()) ? 1 : 0,
        is_viewed: viewedContent.includes(c._id.toString()) ? 1 : 0,
        view_count: metrics.views,
      };

      let score;
      try {
        const response = await axios.post(
          "http://182.93.94.210:0548/predict",
          features
        );
        score = response.data.score * qualityScore;
        if (features.is_viewed) score *= 0.1;
      } catch (err) {
        console.error(`ML service error for _id: ${c._id}:`, err.message);
        const interestMatch = features.interest_match ? 1.3 : 1;
        const relationshipBoost = features.is_following ? 1.5 : 1;
        const recentInteraction = features.recent_interaction ? 1.2 : 1;
        const viewedPenalty = features.is_viewed ? 0.01 : 1;
        const viral = metrics.engagementScore > 100 ? 1.5 : 1;
        const boost = metrics.views > 1000 ? 2 : 1;
        const lessViewedBoost = metrics.views < 100 ? 1.4 : 1;
        const random = 1 + Math.random() * 0.15;

        score =
          (metrics.engagementScore + 1) *
          getTimeDecayScore(c.createdAt) *
          qualityScore *
          interestMatch *
          relationshipBoost *
          recentInteraction *
          viewedPenalty *
          viral *
          boost *
          lessViewedBoost *
          random;
      }

      return { ...c, score: score || Math.random() };
    })
  );

  // Categorize content into videos and normal posts
  const videoContents = scored.filter((c) =>
    c.files?.some((file) => isVideoFile(file))
  );
  const normalContents = scored.filter(
    (c) =>
      !c.files?.some((file) => isVideoFile(file)) &&
      (c.files?.some((file) => isImageFile(file)) || !c.files?.length)
  );

  // Sort by score unless all viewed
  if (!videoContents.every((c) => viewedContent.includes(c._id.toString()))) {
    videoContents.sort((a, b) => b.score - a.score);
    normalContents.sort((a, b) => b.score - a.score);
  }

  const result = { videoContents, normalContents };
  contentCache.set(cacheKey, result);
  return result;
};

// Enrich content with additional data
const enrichContent = async (contents, userEmail) => {
  return Promise.all(
    contents.map(async (content) => {
      const [likes, comments] = await Promise.all([
        Likes.countDocuments({ uid: content._id, type: "content" }),
        Comment.countDocuments({ uid: content._id, type: "content" }),
      ]);

      const liked = await Likes.findOne({
        uid: content._id,
        type: "content",
        "user.email": userEmail,
      });

      return {
        ...content,
        likes,
        comments,
        liked: !!liked,
      };
    })
  );
};

// Main content listing function
const ListContents = async (req, res) => {
  try {
    const { email, name, search, lastId, pageSize = 10 } = req.query;
    const user = req.user;
    const pageSizeNum = parseInt(pageSize, 10) || 10;
    const isRefresh = !lastId;

    const filters = {};
    if (email) filters["author.email"] = email;
    if (name) filters["author.name"] = { $regex: name, $options: "i" };
    if (search) {
      filters.$or = [
        { "author.name": { $regex: search, $options: "i" } },
        { "author.email": { $regex: search, $options: "i" } },
        { status: { $regex: search, $options: "i" } },
      ];
    }
    if (lastId) filters._id = { $lt: lastId };

    const { userDetails, followingEmails, recentLikes, viewedContent } =
      await getUserData(user);
    const engagementScores = await getEngagementScores();

    const { videoContents, normalContents } = await fetchAndScoreContent(
      filters,
      followingEmails,
      viewedContent,
      engagementScores,
      userDetails?.interests || [],
      recentLikes,
      user.email,
      pageSizeNum,
      isRefresh
    );

    // Enrich both content arrays
    const [finalVideos, finalNormal] = await Promise.all([
      enrichContent(videoContents.slice(0, pageSizeNum), user.email),
      enrichContent(normalContents.slice(0, pageSizeNum), user.email),
    ]);

    // hasMore flags for both categories
    const hasMoreVideos = videoContents.length > pageSizeNum;
    const hasMoreNormal = normalContents.length > pageSizeNum;

    return res.status(200).json(
      GenRes(
        200,
        {
          videoContents: finalVideos,
          normalContents: finalNormal,
          hasMoreVideos,
          hasMoreNormal,
          nextVideoCursor: hasMoreVideos
            ? finalVideos[finalVideos.length - 1]?._id || null
            : null,
          nextNormalCursor: hasMoreNormal
            ? finalNormal[finalNormal.length - 1]?._id || null
            : null,
        },
        null,
        `Retrieved ${finalVideos.length} video items and ${finalNormal.length} normal items`
      )
    );
  } catch (err) {
    console.error("ListContents error:", err.message);
    return res.status(500).json(GenRes(500, null, err, err?.message));
  }
};

module.exports = ListContents;
