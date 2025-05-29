const GenRes = require("../../utils/routers/GenRes");
const Follow = require("../follow/follow.model");
const Likes = require("../likes/likes.model");
const Comments = require("../comments/comments.model");
const Content = require("../contents/contents.model");
const User = require("../user/user.model");

// Time decay calculation
const getTimeDecayScore = (createdAt) => {
  const hoursOld =
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  return 1 / (1 + Math.sqrt(hoursOld));
};

// Quality score based on media and author level
const calculateQualityScore = async (content) => {
  let score = content.files?.length ? 1.2 : 1;
  const author = await User.findOne({ email: content.author.email }).lean();
  if (author?.level === "bronze") score *= 1.1;
  return score;
};

// Fetch user data including interests, followings, likes, views
const getUserData = async (user) => {
  const userDetails = await User.findById(user._id).lean();
  const followings = await Follow.find({ "follower.email": user.email });
  const followingEmails = followings.map((f) => f.following.email);
  const recentLikes = await Likes.find({
    "user.email": user.email,
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  }).distinct("uid");
  const viewedContent = await Content.find({ viewedBy: user.email }).distinct(
    "_id"
  );

  return { userDetails, followingEmails, recentLikes, viewedContent };
};

// Fetch engagement metrics
const getEngagementScores = async () => {
  const metrics = await Content.aggregate([
    {
      $lookup: {
        from: "likes",
        localField: "_id",
        foreignField: "uid",
        as: "likes",
      },
    },
    {
      $lookup: {
        from: "comments",
        localField: "_id",
        foreignField: "uid",
        as: "comments",
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

  return new Map(metrics.map((item) => [item._id.toString(), { ...item }]));
};

// Fetch and score content
const fetchAndScoreContent = async (
  filters,
  emails,
  viewedContent,
  engagementScores,
  userInterests,
  recentLikes,
  userEmail
) => {
  const fetchSize = 30;
  const fetchContent = async (emailsInList, excludeViewed = true) => {
    const emailFilter = emailsInList.length
      ? { "author.email": { $in: emailsInList } }
      : {};
    const viewFilter = excludeViewed
      ? { _id: { $nin: viewedContent } }
      : { _id: { $in: viewedContent } };
    return Content.find({ ...filters, ...emailFilter, ...viewFilter })
      .sort({ _id: -1 })
      .limit(fetchSize)
      .lean();
  };

  let contents = [
    ...(await fetchContent(emails, true)),
    ...(await fetchContent([], true)),
  ];
  if (contents.length < 10)
    contents.push(
      ...(await fetchContent(emails, false)),
      ...(await fetchContent([], false))
    );

  const scored = await Promise.all(
    contents.map(async (c) => {
      const metrics = engagementScores.get(c._id.toString()) || {
        engagementScore: 0,
        views: 0,
      };
      const qualityScore = await calculateQualityScore(c);

      const interestMatch = userInterests.some((i) =>
        c.status?.toLowerCase().includes(i.toLowerCase())
      )
        ? 1.3
        : 1;
      const relationshipBoost = emails.includes(c.author.email) ? 1.5 : 1;
      const recentInteraction = recentLikes.includes(c._id.toString())
        ? 1.2
        : 1;
      const viewedPenalty = viewedContent.includes(c._id.toString()) ? 0.1 : 1;
      const viral = metrics.engagementScore > 100 ? 1.5 : 1;
      const boost = metrics.views > 1000 ? 2 : 1;
      const random = 1 + Math.random() * 0.1;

      const score =
        metrics.engagementScore *
        getTimeDecayScore(c.createdAt) *
        qualityScore *
        interestMatch *
        relationshipBoost *
        recentInteraction *
        viewedPenalty *
        viral *
        boost *
        random;
      return { ...c, score };
    })
  );

  return scored.sort((a, b) => b.score - a.score).slice(0, 10);
};

// Add final metadata (likes/comments/follow) to content
const enrichContent = async (items, userEmail) => {
  return Promise.all(
    items.map(async (item) => {
      const base = { uid: item._id, type: "content" };
      const [likes, comments, liked, followed] = await Promise.all([
        Likes.countDocuments(base),
        Comments.countDocuments(base),
        Likes.findOne({ ...base, "user.email": userEmail }),
        Follow.findOne({
          "follower.email": userEmail,
          "following.email": item.author.email,
        }),
      ]);

      const { score, ...rest } = item;
      return { ...rest, likes, comments, liked: !!liked, followed: !!followed };
    })
  );
};

const ListContents = async (req, res) => {
  try {
    const { email, name, search, lastId } = req.query;
    const user = req.user;

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

    const scoredContent = await fetchAndScoreContent(
      filters,
      followingEmails,
      viewedContent,
      engagementScores,
      userDetails?.interests || [],
      recentLikes,
      user.email
    );

    const finalContent = await enrichContent(scoredContent, user.email);
    const hasMore = scoredContent.length > 10;

    return res.status(200).json(
      GenRes(
        200,
        {
          contents: finalContent,
          hasMore,
          nextCursor: hasMore
            ? finalContent[finalContent.length - 1]._id
            : null,
        },
        null,
        `Retrieved ${finalContent.length} content items`
      )
    );
  } catch (err) {
    return res.status(500).json(GenRes(500, null, err, err?.message));
  }
};

module.exports = ListContents;
