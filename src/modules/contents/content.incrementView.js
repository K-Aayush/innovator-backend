const mongoose = require("mongoose");
const Content = require("../contents/contents.model");
const GenRes = require("../../utils/routers/GenRes");
const NodeCache = require("node-cache");

// Optimized cache for view updates
const viewUpdateCache = new NodeCache({ stdTTL: 1800 }); // 30 minutes
const viewCountCache = new NodeCache({ stdTTL: 300 }); // 5 minutes for view counts

// Batch view updates for better performance
const batchViewUpdates = new Map();
let batchTimeout = null;

// Function to process batched view updates
const processBatchedViews = async () => {
  if (batchViewUpdates.size === 0) return;

  const updates = Array.from(batchViewUpdates.entries());
  batchViewUpdates.clear();

  try {
    const bulkOps = updates.map(([contentId, { userEmails, viewCount }]) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(contentId) },
        update: {
          $inc: { views: viewCount },
          $addToSet: { viewedBy: { $each: Array.from(userEmails) } },
        },
      },
    }));

    if (bulkOps.length > 0) {
      await Content.bulkWrite(bulkOps);
      console.log(`Processed ${bulkOps.length} batched view updates`);
    }
  } catch (error) {
    console.error("Batch view update error:", error);
  }
};

// Schedule batch processing
const scheduleBatchProcessing = () => {
  if (batchTimeout) clearTimeout(batchTimeout);
  batchTimeout = setTimeout(processBatchedViews, 2000); // Process every 2 seconds
};

const IncrementView = async (req, res) => {
  try {
    const { id: contentId } = req.params;
    const userEmail = req.user.email;

    // Validate contentId
    if (!mongoose.Types.ObjectId.isValid(contentId)) {
      return res
        .status(400)
        .json(GenRes(400, null, null, "Invalid content ID"));
    }

    // Check if user already viewed this content recently (prevent spam)
    const viewKey = `view_${contentId}_${userEmail}`;
    if (viewUpdateCache.has(viewKey)) {
      return res
        .status(200)
        .json(
          GenRes(
            200,
            { success: true, cached: true },
            null,
            "View already counted"
          )
        );
    }

    // Set cache to prevent duplicate views
    viewUpdateCache.set(viewKey, true);

    // Add to batch for processing
    if (!batchViewUpdates.has(contentId)) {
      batchViewUpdates.set(contentId, { userEmails: new Set(), viewCount: 0 });
    }

    const batchData = batchViewUpdates.get(contentId);
    if (!batchData.userEmails.has(userEmail)) {
      batchData.userEmails.add(userEmail);
      batchData.viewCount += 1;
    }

    // Schedule batch processing
    scheduleBatchProcessing();

    // Update cached view count
    const cacheKey = `views_${contentId}`;
    const cachedViews = viewCountCache.get(cacheKey) || 0;
    viewCountCache.set(cacheKey, cachedViews + 1);

    return res.status(200).json(
      GenRes(
        200,
        {
          success: true,
          batched: true,
          estimatedViews: cachedViews + 1,
        },
        null,
        "View counted (batched)"
      )
    );
  } catch (err) {
    console.error("IncrementView error:", err.message);
    return res.status(500).json(GenRes(500, null, err, err.message));
  }
};

// Get current view count (cached)
const GetViewCount = async (req, res) => {
  try {
    const { id: contentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(contentId)) {
      return res
        .status(400)
        .json(GenRes(400, null, null, "Invalid content ID"));
    }

    const cacheKey = `views_${contentId}`;
    let viewCount = viewCountCache.get(cacheKey);

    if (viewCount === undefined) {
      const content = await Content.findById(contentId).select("views").lean();
      viewCount = content?.views || 0;
      viewCountCache.set(cacheKey, viewCount);
    }

    return res
      .status(200)
      .json(GenRes(200, { views: viewCount }, null, "View count retrieved"));
  } catch (err) {
    console.error("GetViewCount error:", err.message);
    return res.status(500).json(GenRes(500, null, err, err.message));
  }
};

module.exports = { IncrementView, GetViewCount };
