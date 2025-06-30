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

const router = require("express").Router();

// Rate limiter for feed and view requests
const feedRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50, // 50 feed requests per user
  message: "Too many feed requests, please try again later",
});

const viewRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 100, // 100 view requests per user
  message: "Too many view requests, please try again later",
});

// File uploads
router.post("/add-files", basicMiddleware, UserFiles.any(), MultipleFiles);
router.post("/add-file", basicMiddleware, UserFiles.single("file"), SingleFile);
router.post("/delete-files", basicMiddleware, DeleteFiles);

// Content management
router.post("/new-content", basicMiddleware, AddContent);
router.post(
  "/update-contents/:id",
  basicMiddleware,
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
  async (req, res, next) => {
    const { id } = req.params;
    viewCountCache.del(`views_${id}`);
    next();
  },
  DeleteContent
);

// Video reel feed endpoints
router.get(
  "/video-reel",
  basicMiddleware,
  feedRateLimiter,
  GetVideoContentReel
);
router.get("/video-content/:id", basicMiddleware, GetVideoContentById);
router.post("/clear-seen-videos", basicMiddleware, ClearSeenVideoContent);

// View tracking
router.post(
  "/content/:id/view",
  basicMiddleware,
  viewRateLimiter,
  IncrementView
);
router.get("/content/:id/views", basicMiddleware, GetViewCount);

// Consolidated feed endpoint
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

// Legacy routes
router.get("/list-contents", basicMiddleware, ListContents);
router.post("/load-engagement", basicMiddleware, LoadEngagementData);

// Admin routes
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

module.exports = router;
