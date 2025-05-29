const Content = require("../contents/contents.model");
const GenRes = require("../../utils/routers/GenRes");

const IncrementView = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req?.user;

    if (!user?.email) {
      return res
        .status(401)
        .json(GenRes(401, null, null, "User not authenticated"));
    }

    const content = await Content.findById(id);
    if (!content) {
      return res.status(404).json(GenRes(404, null, null, "Content not found"));
    }

    // Check if the user has already viewed this content
    if (!content.viewedBy.includes(user.email)) {
      content.views += 1;
      content.viewedBy.push(user.email);
      await content.save();
    }

    return res
      .status(200)
      .json(GenRes(200, { views: content.views }, null, "View recorded"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = IncrementView;
