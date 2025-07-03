const basicMiddleware = require("../../middlewares/basicMiddleware");
const rateLimit = require("express-rate-limit");
const UserFiles = require("../../utils/fileProcessor/multer.users.js");
const { MultipleFiles, SingleFile, DeleteFiles } = require("./contents.files");
const { ListContents, LoadEngagementData } = require("./contents.list.js");
const {
  IncrementView,
  GetViewCount,
  viewCountCache,
} = require("./content.incrementView.js");
const {
  AddContent,
  UpdateContents,
  DeleteContent,
} = require("./contents.methods");
const {
  GetVideoContentReel,
  GetVideoContentById,
  ClearSeenVideoContent,
} = require("./content.video-reels.js");
const { GetFeed } = require("./content.ml-list.js");
const { GetContentById } = require("./content.single.js");
const {
  GetRandomizedFeed,
  ClearSeenContent,
  GetSeenContentStats,
  UpdateUserInterests,
} = require("./content.randomize-feed.js");

const router = require("express").Router();

// More reasonable rate limiter for feed requests
const feedRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20000,
  message: {
    status: 429,
    data: null,
    error: { message: "Too many feed requests, please try again later" },
    message: "Rate limit exceeded. Please wait before making more requests.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for certain conditions
  skip: (req) => {
    // Skip rate limiting for admin users
    if (req.user?.role === "admin") return true;

    // Skip for refresh requests (less frequent)
    if (req.query.refresh === "true") return false;

    return false;
  },
  // Custom key generator to be more lenient
  keyGenerator: (req) => {
    return `feed_${req.user?._id || req.ip}`;
  },
});

// Separate, more lenient rate limiter for view tracking
const viewRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3000,
  message: {
    status: 429,
    data: null,
    error: { message: "Too many view requests, please try again later" },
    message: "View rate limit exceeded. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return `view_${req.user?._id || req.ip}`;
  },
});

// Very lenient rate limiter for content operations
const contentOperationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 100 operations per 15 minutes
  message: {
    status: 429,
    data: null,
    error: { message: "Too many content operations, please try again later" },
    message: "Content operation rate limit exceeded.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip for admin users
    return req.user?.role === "admin";
  },
});

// File uploads
router.post("/add-files", basicMiddleware, UserFiles.any(), MultipleFiles);
router.post("/add-file", basicMiddleware, UserFiles.single("file"), SingleFile);
router.post("/delete-files", basicMiddleware, DeleteFiles);

// Content management
router.post(
  "/new-content",
  basicMiddleware,
  contentOperationLimiter,
  AddContent
);
router.post(
  "/update-contents/:id",
  basicMiddleware,
  contentOperationLimiter,
  async (req, res, next) => {
    const { id } = req.params;
    viewCountCache.del(`views_${id}`);
    next();
  },
  UpdateContents
);
router.delete(
  "/delete-content/:id",
  basicMiddleware,
  contentOperationLimiter,
  async (req, res, next) => {
    const { id } = req.params;
    viewCountCache.del(`views_${id}`);
    next();
  },
  DeleteContent
);

router.get("/content/:id", basicMiddleware, GetContentById);

// Video reel feed endpoints with more lenient rate limiting
router.get(
  "/video-reel",
  basicMiddleware,
  feedRateLimiter,
  GetVideoContentReel
);
router.get("/video-content/:id", basicMiddleware, GetVideoContentById);
router.post("/clear-seen-videos", basicMiddleware, ClearSeenVideoContent);

// View tracking with separate rate limiter
router.post(
  "/content/:id/view",
  basicMiddleware,
  viewRateLimiter,
  IncrementView
);
router.get("/content/:id/views", basicMiddleware, GetViewCount);

// Main feed endpoint with optimized rate limiting
router.get(
  "/feed",
  basicMiddleware,
  feedRateLimiter,
  validateFeedParams,
  (req, res, next) => {
    req.startTime = Date.now();
    next();
  },
  GetFeed
);

// Enhanced randomized feed endpoints
router.get(
  "/random-feed",
  basicMiddleware,
  feedRateLimiter,
  validateRandomFeedParams,
  GetRandomizedFeed
);

router.post("/clear-seen-content", basicMiddleware, ClearSeenContent);
router.get("/seen-content-stats", basicMiddleware, GetSeenContentStats);
router.post("/update-interests", basicMiddleware, UpdateUserInterests);

// Legacy routes with rate limiting
router.get("/list-contents", basicMiddleware, feedRateLimiter, ListContents);
router.post("/load-engagement", basicMiddleware, LoadEngagementData);

// Admin routes (no rate limiting for admins)
router.get("/list-admin-contents/:page", basicMiddleware, ListContents);
router.delete(
  "/admin-delete-content/:id",
  basicMiddleware,
  async (req, res, next) => {
    const { id } = req.params;
    viewCountCache.del(`views_${id}`);
    next();
  },
  DeleteContent
);

// Validate feed parameters
function validateFeedParams(req, res, next) {
  const { limit, cursor, refresh, quality } = req.query;
  const GenRes = require("../../utils/routers/GenRes");

  if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 50)) {
    return res
      .status(400)
      .json(GenRes(400, null, null, "Invalid limit: must be between 1 and 50"));
  }

  if (cursor && !require("mongoose").Types.ObjectId.isValid(cursor)) {
    return res
      .status(400)
      .json(
        GenRes(400, null, null, "Invalid cursor: must be a valid ObjectId")
      );
  }

  if (quality && !["low", "medium", "high", "auto"].includes(quality)) {
    return res
      .status(400)
      .json(
        GenRes(
          400,
          null,
          null,
          "Invalid quality: must be 'low', 'medium', 'high', or 'auto'"
        )
      );
  }

  if (refresh && !["true", "false"].includes(refresh)) {
    return res
      .status(400)
      .json(
        GenRes(400, null, null, "Invalid refresh: must be 'true' or 'false'")
      );
  }

  next();
}

// Validate random feed parameters
function validateRandomFeedParams(req, res, next) {
  const { limit, cursor, contentType, clearCache, personalized } = req.query;
  const GenRes = require("../../utils/routers/GenRes");

  if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 50)) {
    return res
      .status(400)
      .json(GenRes(400, null, null, "Invalid limit: must be between 1 and 50"));
  }

  if (cursor && !require("mongoose").Types.ObjectId.isValid(cursor)) {
    return res
      .status(400)
      .json(
        GenRes(400, null, null, "Invalid cursor: must be a valid ObjectId")
      );
  }

  if (contentType && !["all", "video", "normal"].includes(contentType)) {
    return res
      .status(400)
      .json(
        GenRes(
          400,
          null,
          null,
          "Invalid contentType: must be 'all', 'video', or 'normal'"
        )
      );
  }

  if (clearCache && !["true", "false"].includes(clearCache)) {
    return res
      .status(400)
      .json(
        GenRes(400, null, null, "Invalid clearCache: must be 'true' or 'false'")
      );
  }

  if (personalized && !["true", "false"].includes(personalized)) {
    return res
      .status(400)
      .json(
        GenRes(
          400,
          null,
          null,
          "Invalid personalized: must be 'true' or 'false'"
        )
      );
  }

  next();
}

module.exports = router;
