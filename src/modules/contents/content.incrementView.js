const mongoose = require("mongoose");
const Content = require("../contents/contents.model");
const GenRes = require("../../utils/routers/GenRes");
const NodeCache = require("node-cache");

// Initialize cache for view updates (shared with other parts of your app)
const viewUpdateCache = new NodeCache({ stdTTL: 3600 });

// Function to check MongoDB connection status
const isMongoConnected = () => {
  return mongoose.connection.readyState === 1;
};

// Function to sync cached view updates
const syncCachedViews = async () => {
  const cachedUpdates = viewUpdateCache.keys();
  for (const key of cachedUpdates) {
    const update = viewUpdateCache.get(key);
    try {
      const result = await Content.updateOne(
        { _id: update.contentId },
        { $inc: { views: 1 }, $addToSet: { viewedBy: update.userEmail } }
      );
      if (result.modifiedCount > 0) {
        console.log(
          `Synced view for content ${update.contentId} for user ${update.userEmail}`
        );
        viewUpdateCache.del(key); // Remove from cache after successful sync
      } else {
        console.warn(
          `Sync failed for content ${update.contentId}: already viewed or not found`
        );
      }
    } catch (err) {
      console.error(`Sync error for content ${update.contentId}:`, err.message);
      // Keep in cache for next sync attempt
    }
  }
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

    // Convert contentId to ObjectId
    const objectId = new mongoose.Types.ObjectId(contentId);

    // Check MongoDB connection
    if (!isMongoConnected()) {
      // Store view update in cache when offline
      const cacheKey = `view_${contentId}_${userEmail}`;
      viewUpdateCache.set(cacheKey, { contentId, userEmail });
      console.log(
        `Cached view update for content ${contentId} for user ${userEmail}`
      );
      return res
        .status(200)
        .json(
          GenRes(
            200,
            { success: true, cached: true },
            null,
            "View cached for later sync"
          )
        );
    }

    // Online: Check if content exists
    const content = await Content.findById(objectId);
    if (!content) {
      return res.status(404).json(GenRes(404, null, null, "Content not found"));
    }

    // Update view count and viewedBy
    const result = await Content.updateOne(
      { _id: objectId },
      { $inc: { views: 1 }, $addToSet: { viewedBy: userEmail } }
    );

    console.log(`Updated content ${contentId} for user ${userEmail}:`, result);

    if (result.modifiedCount === 0) {
      console.warn(
        `No update for content ${contentId}: already viewed or not found`
      );
    }

    // Sync any cached updates (if recently came online)
    await syncCachedViews();

    return res
      .status(200)
      .json(GenRes(200, { success: true }, null, "View incremented"));
  } catch (err) {
    console.error("IncrementView error:", err.message);
    // Cache the update if the error is due to being offline
    if (
      err.name === "MongoServerSelectionError" ||
      err.message.includes("connect")
    ) {
      const cacheKey = `view_${contentId}_${userEmail}`;
      viewUpdateCache.set(cacheKey, { contentId, userEmail });
      console.log(
        `Cached view update due to offline error for content ${contentId}`
      );
      return res
        .status(200)
        .json(
          GenRes(
            200,
            { success: true, cached: true },
            null,
            "View cached for later sync"
          )
        );
    }
    return res.status(500).json(GenRes(500, null, err, err.message));
  }
};

module.exports = IncrementView;
