const Content = require("./contents.model");
const User = require("../user/user.model");
const Follow = require("../follow/follow.model");
const Like = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const NodeCache = require("node-cache");

// Cache for video reel feed optimization
const videoReelCache = new NodeCache({ stdTTL: 300 });
const userSeenVideoCache = new NodeCache({ stdTTL: 86400 });

// Helper function to check if content has video files
const hasVideoFiles = (files) => {
  if (!files || !Array.isArray(files)) return false;
  const videoExtensions = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m3u8"];
  return files.some((file) =>
    videoExtensions.some((ext) => file.toLowerCase().endsWith(ext))
  );
};

// Generate HLS URL for video streaming
const generateHLSUrl = (videoUrl) => {
  if (!videoUrl) return null;
  const basePath = videoUrl.replace(/\.[^/.]+$/, "");
  return `${basePath}/playlist.m3u8`;
};

// Generate thumbnail URL
const generateThumbnailUrl = (fileUrl) => {
  if (!fileUrl) return null;
  const basePath = fileUrl.replace(/\.[^/.]+$/, "");
  const pathParts = basePath.split("/");
  pathParts.splice(-1, 0, "thumbnails");
  return `${pathParts.join("/")}_thumb.jpg`;
};

// Calculate engagement rate
const calculateEngagementRate = (likes, comments, shares, views) => {
  if (views === 0) return 0;
  return ((likes + comments * 2 + shares * 3) / views) * 100;
};

// Track seen video content for user
const trackSeenVideoContent = (userId, contentId) => {
  const key = `seen_video_content_${userId}`;
  const seenContent = userSeenVideoCache.get(key) || new Set();
  seenContent.add(contentId.toString());
  userSeenVideoCache.set(key, seenContent);
  return seenContent;
};

// Get seen video content for user
const getSeenVideoContent = (userId) => {
  const key = `seen_video_content_${userId}`;
  return userSeenVideoCache.get(key) || new Set();
};

// Get single video content for reel-style feed
const GetVideoContentReel = async (req, res) => {
  try {
    const { lastContentId, refresh = "false" } = req.query;
    const user = req.user;
    const userId = user._id;
    const forceRefresh = refresh === "true";

    // Get user's seen video content
    let seenVideoContent = getSeenVideoContent(userId);

    // Clear seen content on refresh
    if (forceRefresh) {
      userSeenVideoCache.del(`seen_video_content_${userId}`);
      seenVideoContent = new Set();
    }

    const seenContentIds = Array.from(seenVideoContent);

    // Build filters for content with video files
    const filters = {
      // Filter for content that has video files
      $expr: {
        $gt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$files", []] },
                cond: {
                  $regexMatch: {
                    input: "$$this",
                    regex: /\.(mp4|mov|webm|avi|mkv|m3u8)$/i,
                  },
                },
              },
            },
          },
          0,
        ],
      },
      // Exclude seen content
      _id: {
        $nin: seenContentIds
          .map((id) => (isValidObjectId(id) ? id : null))
          .filter(Boolean),
      },
    };

    // Add cursor pagination
    if (lastContentId && isValidObjectId(lastContentId)) {
      filters._id = {
        ...filters._id,
        $lt: lastContentId,
      };
    }

    // Get user's following list for personalized feed
    const following = await Follow.find({ "follower.email": user.email })
      .select("following.email following._id")
      .lean();
    const followingEmails = following.map((f) => f.following.email);

    // Instagram-like algorithm: 70% followed users, 30% discovery
    const followedFilters = {
      ...filters,
      "author.email": { $in: followingEmails },
    };

    const discoveryFilters = {
      ...filters,
      "author.email": { $nin: followingEmails },
      views: { $gte: 50 },
    };

    // Try to get video content from followed users first
    let videoContent = await Content.findOne(followedFilters)
      .sort({ createdAt: -1, views: -1 })
      .lean();

    // If no content from followed users, get from discovery
    if (!videoContent) {
      videoContent = await Content.findOne(discoveryFilters)
        .sort({ views: -1, createdAt: -1 })
        .lean();
    }

    // If still no content, get any available video content
    if (!videoContent) {
      videoContent = await Content.findOne(filters)
        .sort({ createdAt: -1 })
        .lean();
    }

    if (!videoContent) {
      // If no new video content, reset seen content and try again
      userSeenVideoCache.del(`seen_video_content_${userId}`);

      videoContent = await Content.findOne({
        $expr: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ["$files", []] },
                  cond: {
                    $regexMatch: {
                      input: "$$this",
                      regex: /\.(mp4|mov|webm|avi|mkv|m3u8)$/i,
                    },
                  },
                },
              },
            },
            0,
          ],
        },
      })
        .sort({ createdAt: -1 })
        .lean();
    }

    if (!videoContent) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "No video content found" },
            "No video content available"
          )
        );
    }

    // Track this content as seen
    trackSeenVideoContent(userId, videoContent._id);

    // Get the video file from files array
    const videoFile = videoContent.files?.find((file) => hasVideoFiles([file]));

    if (!videoFile) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "No video file found in content" },
            "Video file not available"
          )
        );
    }

    // Get engagement data
    const [likes, comments, shares] = await Promise.all([
      Like.countDocuments({ uid: videoContent._id, type: "content" }),
      Comment.countDocuments({ uid: videoContent._id, type: "content" }),
      Content.countDocuments({
        "originalContent._id": videoContent._id,
        isShared: true,
      }),
    ]);

    // Check user interactions
    const [liked, commented, followStatus] = await Promise.all([
      Like.findOne({
        uid: videoContent._id,
        type: "content",
        "user.email": user.email,
      }),
      Comment.findOne({
        uid: videoContent._id,
        type: "content",
        "user.email": user.email,
      }),
      Follow.findOne({
        "follower._id": userId,
        "following._id": videoContent.author._id,
      }),
    ]);

    // Optimize video content for reel-style viewing
    const optimizedVideoContent = {
      _id: videoContent._id,
      status: videoContent.status,
      type: videoContent.type,
      author: videoContent.author,
      createdAt: videoContent.createdAt,
      views: videoContent.views || 0,
      isShared: videoContent.isShared || false,
      originalContent: videoContent.originalContent,

      // Video-specific data
      videoUrl: videoFile,
      allFiles: videoContent.files,

      // Engagement data
      likes,
      comments,
      shares,
      liked: !!liked,
      commented: !!commented,
      following: !!followStatus,

      // Video streaming optimization
      streamingUrls: {
        hls: generateHLSUrl(videoFile),
        original: videoFile,
        thumbnail: generateThumbnailUrl(videoFile),
      },

      // Playback settings for reel-style viewing
      playbackSettings: {
        autoplay: true,
        muted: true,
        loop: true,
        preload: "auto",
        controls: true,
        playsInline: true,
      },

      // Additional metadata
      engagementRate: calculateEngagementRate(
        likes,
        comments,
        shares,
        videoContent.views || 0
      ),
      isFollowing: !!following,
      canShare: true,
      canDownload: false,
      contentType: "video",

      // Feed metadata
      feedPosition: "current",
      loadPriority: "high",
      hasMore: true,
    };

    // Increment view count asynchronously
    setImmediate(async () => {
      try {
        await Content.updateOne(
          { _id: videoContent._id },
          {
            $inc: { views: 1 },
            $addToSet: { viewedBy: user.email },
          }
        );
      } catch (error) {
        console.error("Error incrementing content view:", error);
      }
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          optimizedVideoContent,
          null,
          "Video content retrieved successfully"
        )
      );
  } catch (error) {
    console.error("GetVideoContentReel error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get video content by specific ID (for direct access)
const GetVideoContentById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid content ID" },
            "Invalid content ID"
          )
        );
    }

    // Find the content
    const videoContent = await Content.findById(id).lean();

    if (!videoContent) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Content not found" }, "Content not found")
        );
    }

    // Check if content has video files
    if (!hasVideoFiles(videoContent.files)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Content does not contain video" },
            "Not a video content"
          )
        );
    }

    // Get the video file
    const videoFile = videoContent.files?.find((file) => hasVideoFiles([file]));

    // Get engagement data
    const [likes, comments, shares] = await Promise.all([
      Like.countDocuments({ uid: videoContent._id, type: "content" }),
      Comment.countDocuments({ uid: videoContent._id, type: "content" }),
      Content.countDocuments({
        "originalContent._id": videoContent._id,
        isShared: true,
      }),
    ]);

    // Check user interactions
    const [liked, commented, following] = await Promise.all([
      Like.findOne({
        uid: videoContent._id,
        type: "content",
        "user.email": user.email,
      }),
      Comment.findOne({
        uid: videoContent._id,
        type: "content",
        "user.email": user.email,
      }),
      Follow.findOne({
        "follower._id": user._id,
        "following._id": videoContent.author._id,
      }),
    ]);

    // Prepare optimized response
    const optimizedVideoContent = {
      _id: videoContent._id,
      status: videoContent.status,
      type: videoContent.type,
      author: videoContent.author,
      createdAt: videoContent.createdAt,
      views: videoContent.views || 0,
      isShared: videoContent.isShared || false,
      originalContent: videoContent.originalContent,

      // Video-specific data
      videoUrl: videoFile,
      allFiles: videoContent.files,

      // Engagement data
      likes,
      comments,
      shares,
      liked: !!liked,
      commented: !!commented,
      following: !!following,

      // Video streaming optimization
      streamingUrls: {
        hls: generateHLSUrl(videoFile),
        original: videoFile,
        thumbnail: generateThumbnailUrl(videoFile),
      },

      // Playback settings
      playbackSettings: {
        autoplay: true,
        muted: true,
        loop: true,
        preload: "auto",
        controls: true,
        playsInline: true,
      },

      // Additional metadata
      engagementRate: calculateEngagementRate(
        likes,
        comments,
        shares,
        videoContent.views || 0
      ),
      isFollowing: !!following,
      canShare: true,
      canDownload: false,
      contentType: "video",
    };

    // Track as seen and increment view
    trackSeenVideoContent(user._id, videoContent._id);

    setImmediate(async () => {
      try {
        await Content.updateOne(
          { _id: videoContent._id },
          {
            $inc: { views: 1 },
            $addToSet: { viewedBy: user.email },
          }
        );
      } catch (error) {
        console.error("Error incrementing content view:", error);
      }
    });

    return res
      .status(200)
      .json(
        GenRes(
          200,
          optimizedVideoContent,
          null,
          "Video content retrieved successfully"
        )
      );
  } catch (error) {
    console.error("GetVideoContentById error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Clear seen video content (for refresh)
const ClearSeenVideoContent = async (req, res) => {
  try {
    const userId = req.user._id;
    userSeenVideoCache.del(`seen_video_content_${userId}`);

    return res
      .status(200)
      .json(GenRes(200, { cleared: true }, null, "Seen video content cleared"));
  } catch (error) {
    console.error("ClearSeenVideoContent error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  GetVideoContentReel,
  GetVideoContentById,
  ClearSeenVideoContent,
};
