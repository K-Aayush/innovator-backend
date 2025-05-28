const GenRes = require("../../utils/routers/GenRes");
const Follow = require("../follow/follow.model");
const Likes = require("../likes/likes.model");
const Comments = require("../comments/comments.model");
const Content = require("../contents/contents.model");

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
      ];
    }

    // Add cursor-based pagination
    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Get following list for the current user
    const followings = await Follow.find({ "follower.email": user?.email });
    const followingEmails = followings.map((f) => f.following.email);

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
              { $size: "$likes" },
              { $multiply: [{ $size: "$comments" }, 2] },
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

    // Combine and sort content based on algorithm
    const allContent = [...followingContent, ...otherContent].map(
      (content) => ({
        ...content,
        score: calculateContentScore(
          content,
          engagementScores,
          followingEmails
        ),
      })
    );

    // Sort by score and take required number of items
    const sortedContent = allContent
      .sort((a, b) => b.score - a.score)
      .slice(0, pageSize);

    // Remove score from final output
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

// Helper function to calculate content score
function calculateContentScore(content, engagementScores, followingEmails) {
  const baseScore = engagementScores.get(content._id.toString()) || 0;
  const timeDecay = 1 / Math.sqrt(1 + getHoursSinceCreation(content.createdAt));
  const followingBonus = followingEmails.includes(content.author.email) ? 2 : 1;
  const shareBonus = content.isShared ? 1.5 : 1;

  return baseScore * timeDecay * followingBonus * shareBonus;
}

function getHoursSinceCreation(createdAt) {
  return (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
}

module.exports = ListContents;
