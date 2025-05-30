const Content = require("../contents/contents.model");
const GenRes = require("../../utils/routers/GenRes");

const IncrementView = async (req, res) => {
  try {
    const { contentId } = req.params;
    const userEmail = req.user.email;

    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json(GenRes(404, null, null, "Content not found"));
    }

    const result = await Content.updateOne(
      { _id: contentId },
      { $inc: { views: 1 }, $addToSet: { viewedBy: userEmail } }
    );

    console.log(`Updated content ${contentId} for user ${userEmail}:`, result);

    if (result.modifiedCount === 0) {
      console.warn(
        `No update for content ${contentId}: already viewed or not found`
      );
    }

    return res
      .status(200)
      .json(GenRes(200, { success: true }, null, "View incremented"));
  } catch (err) {
    console.error("IncrementView error:", err.message);
    return res.status(500).json(GenRes(500, null, err, err.message));
  }
};

module.exports = IncrementView;
