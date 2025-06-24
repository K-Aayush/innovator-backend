const basicMiddleware = require("../../middlewares/basicMiddleware");
const UserFiles = require("../../utils/fileProcessor/multer.users.js");
const { MultipleFiles, SingleFile, DeleteFiles } = require("./contents.files");
const { ListContents, LoadEngagementData } = require("./contents.list.js");
const { IncrementView, GetViewCount } = require("./content.incrementView.js");
const {
  AddContent,
  UpdateContents,
  DeleteContent,
} = require("./contents.methods");

// Import new ML-powered feed methods
const {
  GetPersonalizedFeed,
  GetVideoFeed,
  GetContentFeed,
  GetTrendingFeed,
  RefreshFeed,
  GetFeedAnalytics,
} = require("./content.ml-list.js");

const router = require("express").Router();

// files
// add multiple files
router.post("/add-files", basicMiddleware, UserFiles.any(), MultipleFiles);

//single file | add or updateadd
router.post("/add-file", basicMiddleware, UserFiles.single("file"), SingleFile);

// delete files
router.post("/delete-files", basicMiddleware, DeleteFiles);

// post new data
router.post("/new-content", basicMiddleware, AddContent);

// update data
router.post("/update-contents/:id", basicMiddleware, UpdateContents);

//update increment
router.post("/content/:id/view", basicMiddleware, IncrementView);
router.get("/content/:id/views", basicMiddleware, GetViewCount);

// delete whole contents
router.delete("/delete-content/:id", basicMiddleware, DeleteContent);

// NEW ML-POWERED FEED ROUTES
// Main personalized feed (Instagram-like with mixed content)
router.get("/feed", basicMiddleware, GetPersonalizedFeed);

// Video-only feed (for video tab/page)
router.get("/feed/videos", basicMiddleware, GetVideoFeed);

// Content-only feed (for content tab/page)
router.get("/feed/content", basicMiddleware, GetContentFeed);

// Trending feed
router.get("/feed/trending", basicMiddleware, GetTrendingFeed);

// Refresh feed
router.post("/feed/refresh", basicMiddleware, RefreshFeed);

// Feed analytics (admin only)
router.get("/feed/analytics", basicMiddleware, GetFeedAnalytics);

// LEGACY ROUTES (kept for backward compatibility)
// get data - optimized
router.get("/list-contents", basicMiddleware, ListContents);

// load engagement data on demand
router.post("/load-engagement", basicMiddleware, LoadEngagementData);

// admin
router.get("/list-admin-contents/:page", basicMiddleware, ListContents);

// make delete
router.delete("/admin-delete-content/:id", basicMiddleware, DeleteContent);

module.exports = router;
