const GenRes = require("../../utils/routers/GenRes");
const Follow = require("../follow/follow.model");
const Likes = require("../likes/likes.model");
const Comments = require("../comments/comments.model");
const Content = require("../contents/contents.model");

function shuffleArray(array) {
  // Fisher-Yates Shuffle
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const ListContents = async (req, res) => {
  try {
    const queries = req?.query;
    const page = parseInt(req?.params?.page || "0") || 0;
    const pageSize = 10;
    const lastId = req.query.lastId;

    const filters = {};
    const authenQuery = "email,name,search".split(",");
    const user = req?.user;

    // Extract query filters
    for (const query of authenQuery) {
      if (queries?.[query]) {
        if (query === "email") {
          filters["author.email"] = queries[query];
        } else if (query === "name") {
          filters["author.name"] = { $regex: queries[query], $options: "i" };
        } else if (query === "search") {
          filters.$or = [
            { "author.name": { $regex: queries[query], $options: "i" } },
            { "author.email": { $regex: queries[query], $options: "i" } },
          ];
        }
      }
    }

    // Add cursor-based pagination
    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Get followings only if no filter applied
    let followingEmails = [];
    if (Object.keys(filters)?.length === 0) {
      const followings = await Follow.find({ "follower.email": user?.email });
      followingEmails = followings.map((item) => item.following.email);
    }

    // Fetch contents with cursor-based pagination
    const recentContents = await Content.find(filters)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();

    // Split into relevant and irrelevant
    const relevant = [];
    const irrelevant = [];

    const hasMore = recentContents.length > pageSize;
    const contents = hasMore ? recentContents.slice(0, -1) : recentContents;

    for (const content of contents) {
      const authorEmail = content.author?.email || "";
      const authorName = content.author?.name || "";

      let isRelevant = false;

      if (filters["author.email"] && authorEmail === filters["author.email"]) {
        isRelevant = true;
      } else if (
        filters["author.name"] &&
        new RegExp(filters["author.name"].$regex, "i").test(authorName)
      ) {
        isRelevant = true;
      } else if (
        filters.$or &&
        (new RegExp(filters.$or[0]["author.name"].$regex, "i").test(
          authorName
        ) ||
          new RegExp(filters.$or[1]["author.email"].$regex, "i").test(
            authorEmail
          ))
      ) {
        isRelevant = true;
      } else if (
        followingEmails.length > 0 &&
        followingEmails.includes(authorEmail)
      ) {
        isRelevant = true;
      } else if (Object.keys(filters).length === 0) {
        isRelevant = true;
      }

      if (isRelevant) {
        relevant.push(content);
      } else {
        irrelevant.push(content);
      }
    }

    // Combine and shuffle
    const mixedContent = shuffleArray([...relevant, ...irrelevant]);

    // Attach likes, comments, and liked status
    const finalCall = await Promise.all(
      mixedContent.map(async (item) => {
        const find = { uid: item?._id, type: "content" };
        const likes = await Likes.countDocuments(find);
        const comments = await Comments.countDocuments(find);
        const liked = await Likes.findOne({
          ...find,
          "user.email": user?.email,
        });

        const followed = await Follow.findOne({
          "follower.email": user?.email,
          "following.email": item?.author?.email,
        });

        item.liked = !!liked;
        item.followed = !!followed;
        item.likes = likes;
        item.comments = comments;

        return item;
      })
    );

    const response = GenRes(
      200,
      {
        contents: finalCall,
        hasMore,
        nextCursor: hasMore ? contents[contents.length - 1]._id : null,
      },
      null,
      "Responding shuffled & paginated content"
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = ListContents;
