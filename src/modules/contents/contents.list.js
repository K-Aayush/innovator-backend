const GenRes = require("../../utils/routers/GenRes");
const Follow = require("../follow/follow.model");
const Likes = require("../likes/likes.model");
const Comments = require("../comments/comments.model");
const Content = require("../contents/contents.model");

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const ListContents = async (req, res) => {
  try {
    const { email, name, search, lastId } = req.query;
    const user = req?.user;
    const pageSize = 10;

    const filters = {};

    // Filtering logic
    if (email) filters["author.email"] = email;
    if (name) filters["author.name"] = { $regex: name, $options: "i" };
    if (search) {
      filters.$or = [
        { "author.name": { $regex: search, $options: "i" } },
        { "author.email": { $regex: search, $options: "i" } },
      ];
    }

    // Cursor-based pagination
    if (lastId) {
      filters._id = { $lt: lastId };
    }

    // Get following emails if no filter is applied
    let followingEmails = [];
    if (Object.keys(filters).length === 0) {
      const followings = await Follow.find({ "follower.email": user?.email });
      followingEmails = followings.map((f) => f.following.email);
    }

    // Fetch content
    const allContents = await Content.find(filters)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = allContents.length > pageSize;
    const contents = hasMore ? allContents.slice(0, -1) : allContents;

    // Determine relevance
    const relevant = [],
      irrelevant = [];
    for (const content of contents) {
      const authorEmail = content.author?.email || "";
      const authorName = content.author?.name || "";

      let isRelevant =
        (email && authorEmail === email) ||
        (name && new RegExp(name, "i").test(authorName)) ||
        (search &&
          (new RegExp(search, "i").test(authorName) ||
            new RegExp(search, "i").test(authorEmail))) ||
        (followingEmails.length > 0 && followingEmails.includes(authorEmail)) ||
        Object.keys(filters).length === 0;

      (isRelevant ? relevant : irrelevant).push(content);
    }

    // Shuffle content
    const mixedContent = shuffleArray([...relevant, ...irrelevant]);

    // Attach likes, comments, and followed status
    const finalContent = await Promise.all(
      mixedContent.map(async (item) => {
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

        return {
          ...item,
          liked: !!liked,
          likes,
          comments,
          followed: !!followed,
        };
      })
    );

    // Response format
    const response = GenRes(
      200,
      {
        contents: finalContent,
        hasMore,
        nextCursor: hasMore ? contents[contents.length - 1]._id : null,
      },
      null,
      `Retrieved ${finalContent.length} content items`
    );

    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = ListContents;
