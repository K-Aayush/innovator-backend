const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const VideoFiles = require("../../utils/fileProcessor/multer.video");
const {
  AddVideo,
  UpdateVideo,
  DeleteVideo,
  IncrementVideoView,
} = require("./video.methods");
const {
  ListVideos,
  ListReels,
  GetVideo,
  GetUserVideos,
} = require("./video.list");
const { ShareVideo, GetVideoShares } = require("./video.share");

// Video upload and management
router.post(
  "/upload-video",
  basicMiddleware,
  VideoFiles.single("video"),
  AddVideo
);

router.put("/videos/:id", basicMiddleware, UpdateVideo);
router.delete("/videos/:id", basicMiddleware, DeleteVideo);

// Video viewing
router.post("/videos/:id/view", basicMiddleware, IncrementVideoView);
router.get("/video/:id", basicMiddleware, GetVideo);

// Video listing
router.get("/videos", basicMiddleware, ListVideos);
router.get("/reels", basicMiddleware, ListReels);
router.get("/user/:userId/videos", basicMiddleware, GetUserVideos);

// Video sharing
router.post("/share-video", basicMiddleware, ShareVideo);
router.get("/video/:videoId/shares", basicMiddleware, GetVideoShares);

module.exports = router;
