const GenRes = require("../../utils/routers/GenRes");
const Follow = require("../follow/follow.model");
const Likes = require("../likes/likes.model");
const Comments = require("../comments/comments.model");
const Content = require("../contents/contents.model");
const User = require("../user/user.model");

// Helper function to calculate time decay
function getTimeDecayScore(createdAt) {
  const hoursAge =
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  return 1 / (1 + Math.sqrt(hoursAge));
}

// Helper function to calculate content quality score
async function calculateQualityScore(content) {
  let score = 1;

  // Boost content with media
  if (content.files && content.files.length > 0) {
    score *= 1.2;
  }

  // Fetch author details from User model
  const author = await User.findOne({ email: content.author.email }).lean();

  // Boost based on author's level
  if (author?.level === "bronze") {
    score *= 1.1;
  }

  return score;
}

const ListContents = async (req, res) => {
  try {
    const { email, name, search, lastId } = req.query;
    const user = req?.user;
    const pageSize = 10;

    // Base filters
    const filters = {};

    // Add specific filters if provided
    if (email) filters["author.email"] = email;
    if (name) filters["author.name"] = { $regex: name, $options: "i" };
    if (search) {
      filters.$or = [
        { "author.name": { $regex: search, $options: "i" } },
        { "author.email": { $regex: search, $options: "i" } },
        { status: { $regex: search, $options: "i" } },
      ];
    }

    // Add cursor-based pagination
    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Get user's interests and preferences
    const userDetails = await User.findById(user?._id).lean();
    const userInterests = userDetails?.interests || [];

    // Get following list for the current user
    const followings = await Follow.find({ "follower.email": user?.email });
    const followingEmails = followings.map((f) => f.following.email);

    // Get user's recent interactions
    const recentLikes = await Likes.find({
      "user.email": user?.email,
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }).distinct("uid");

    // Get engagement metrics for content ranking
    const engagementMetrics = await Content.aggregate([
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
          engagementScore: {
            $add: [
              { $multiply: [{ $size: "$likes" }, 1] },
              { $multiply: [{ $size: "$comments" }, 2] },
              { $multiply: [{ $ifNull: ["$views", 0] }, 0.1] }, // Include views
            ],
          },
        },
      },
    ]);

    // Create engagement score map
    const engagementScores = new Map(
      engagementMetrics.map((item) => [
        item._id.toString(),
        item.engagementScore,
      ])
    );

    // Fetch content with separate queries for following and non-following
    const [followingContent, otherContent] = await Promise.all([
      // Content from followed users
      Content.find({
        ...filters,
        "author.email": { $in: followingEmails },
      })
        .sort({ _id: -1 })
        .limit(pageSize)
        .lean(),

      // Content from non-followed users
      Content.find({
        ...filters,
        "author.email": { $nin: followingEmails },
      })
        .sort({ _id: -1 })
        .limit(pageSize)
        .lean(),
    ]);

    // Combine and calculate scores for all content
    const allContent = await Promise.all(
      [...followingContent, ...otherContent].map(async (content) => {
        const baseEngagementScore =
          engagementScores.get(content._id.toString()) || 0;
        const timeDecay = getTimeDecayScore(content.createdAt);
        const qualityScore = await calculateQualityScore(content);

        // Calculate interest match score
        const interestMatchScore = userInterests.some((interest) =>
          content.status?.toLowerCase().includes(interest.toLowerCase())
        )
          ? 1.3
          : 1;

        // Calculate relationship boost
        const relationshipBoost = followingEmails.includes(content.author.email)
          ? 1.5
          : 1;

        // Calculate recency boost for interactions
        const recentInteractionBoost = recentLikes.includes(
          content._id.toString()
        )
          ? 1.2
          : 1;

        // Calculate viral coefficient (simplified)
        const viralCoefficient = baseEngagementScore > 100 ? 1.5 : 1;

        // Boosted content gets priority
        const boostMultiplier = content.isBoosted ? 2 : 1;

        // Final score calculation
        const finalScore =
          baseEngagementScore *
          timeDecay *
          qualityScore *
          interestMatchScore *
          relationshipBoost *
          recentInteractionBoost *
          viralCoefficient *
          boostMultiplier;

        return {
          ...content,
          score: finalScore,
        };
      })
    );

    // Sort by score and take required number of items
    const sortedContent = allContent
      .sort((a, b) => b.score - a.score)
      .slice(0, pageSize);

    // Remove score from final output and add engagement metrics
    const finalContent = await Promise.all(
      sortedContent.map(async (item) => {
        const base = { uid: item._id, type: "content" };

        const [likes, comments, liked, followed] = await Promise.all([
          Likes.countDocuments(base),
          Comments.countDocuments(base),
          Likes.findOne({ ...base, "user.email": user?.email }),
          Follow.findOne({
            "follower.email": user?.email,
            "following.email": item?.author?.email,
          }),
        ]);

        const { score, ...contentWithoutScore } = item;
        return {
          ...contentWithoutScore,
          liked: !!liked,
          likes,
          comments,
          followed: !!followed,
        };
      })
    );

    // Determine if there are more items
    const hasMore = finalContent.length === pageSize;

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
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = ListContents;
