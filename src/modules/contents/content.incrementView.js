const Content = require("../contents/contents.model");
const GenRes = require("../../utils/routers/GenRes");

const IncrementView = async (req, res) => {
  try {
    const { id } = req.params;
    const content = await Content.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!content) {
      return res.status(404).json(GenRes(404, null, null, "Content not found"));
    }
    return res
      .status(200)
      .json(GenRes(200, { views: content.views }, null, "View recorded"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = IncrementView;
