// content.incrementView.js
const mongoose = require("mongoose");
const Content = require("../contents/contents.model");
const GenRes = require("../../utils/routers/GenRes");
const NodeCache = require("node-cache");

const viewUpdateCache = new NodeCache({ stdTTL: 600 });
const viewCountCache = new NodeCache({ stdTTL: 300 });

const batchViewUpdates = new Map();
let batchTimeout = null;

// Process batched view updates
const processBatchedViews = async () => {
  if (batchViewUpdates.size === 0) return;

  const updates = Array.from(batchViewUpdates.entries());
  batchViewUpdates.clear();

  try {
    // Validate content existence
    const contentIds = updates.map(
      ([contentId]) => new mongoose.Types.ObjectId(contentId)
    );
    const existingContent = await Content.find({ _id: { $in: contentIds } })
      .select("_id")
      .lean();
    const validContentIds = new Set(
      existingContent.map((c) => c._id.toString())
    );

    const bulkOps = updates
      .filter(([contentId]) => validContentIds.has(contentId))
      .map(([contentId, { userEmails, viewCount }]) => ({
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

      // Update view count cache
      updates.forEach(([contentId, { viewCount }]) => {
        if (validContentIds.has(contentId)) {
          const cacheKey = `views_${contentId}`;
          const currentViews = viewCountCache.get(cacheKey) || 0;
          viewCountCache.set(cacheKey, currentViews + viewCount);
        }
      });
    }
  } catch (error) {
    console.error("Batch view update error:", error);
  }
};

// Schedule batch processing (adaptive interval)
const scheduleBatchProcessing = () => {
  if (batchTimeout) clearTimeout(batchTimeout);
  const interval = Math.min(2000, 1000 + batchViewUpdates.size * 10); // Adaptive: 1-2 seconds
  batchTimeout = setTimeout(processBatchedViews, interval);
};

const IncrementView = async (req, res) => {
  try {
    const { id: contentId } = req.params;
    const userEmail = req.user.email;

    if (!mongoose.Types.ObjectId.isValid(contentId)) {
      return res
        .status(400)
        .json(GenRes(400, null, null, "Invalid content ID"));
    }

    // Check content existence
    const contentExists = await Content.exists({ _id: contentId });
    if (!contentExists) {
      return res.status(404).json(GenRes(404, null, null, "Content not found"));
    }

    const viewKey = `view_${contentId}_${userEmail}`;
    if (viewUpdateCache.has(viewKey)) {
      const cachedViews = viewCountCache.get(`views_${contentId}`) || 0;
      return res
        .status(200)
        .json(
          GenRes(
            200,
            { success: true, cached: true, estimatedViews: cachedViews },
            null,
            "View already counted"
          )
        );
    }

    viewUpdateCache.set(viewKey, true);

    if (!batchViewUpdates.has(contentId)) {
      batchViewUpdates.set(contentId, { userEmails: new Set(), viewCount: 0 });
    }

    const batchData = batchViewUpdates.get(contentId);
    if (!batchData.userEmails.has(userEmail)) {
      batchData.userEmails.add(userEmail);
      batchData.viewCount += 1;
    }

    // Cap batch size to prevent memory issues
    if (batchViewUpdates.size >= 1000) {
      await processBatchedViews();
    } else {
      scheduleBatchProcessing();
    }

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
      if (!content) {
        return res
          .status(404)
          .json(GenRes(404, null, null, "Content not found"));
      }
      viewCount = content.views || 0;
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

module.exports = { IncrementView, GetViewCount, viewCountCache };
