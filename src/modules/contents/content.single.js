const Content = require("./contents.model");
const Video = require("../video/video.model");
const Like = require("../likes/likes.model");
const Comment = require("../comments/comments.model");
const Follow = require("../follow/follow.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

// Helper function to check if content has video files
const hasVideoFiles = (files) => {
  if (!files || !Array.isArray(files)) return false;
  const videoExtensions = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m3u8"];
  return files.some((file) =>
    videoExtensions.some((ext) => file.toLowerCase().endsWith(ext))
  );
};

// Helper function to check if content has image files
const hasImageFiles = (files) => {
  if (!files || !Array.isArray(files)) return false;
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
  return files.some((file) =>
    imageExtensions.some((ext) => file.toLowerCase().endsWith(ext))
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

// Determine content type based on files
const determineContentType = (files) => {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return "text";
  }

  const hasVideo = hasVideoFiles(files);
  const hasImage = hasImageFiles(files);

  if (hasVideo) return "video";
  if (hasImage) return "image";
  return "text";
};

// Calculate engagement rate
const calculateEngagementRate = (likes, comments, shares, views) => {
  if (views === 0) return 0;
  return ((likes + comments * 2 + shares * 3) / views) * 100;
};

// Get content by ID (unified for all content types)
const GetContentById = async (req, res) => {
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

    // Try to find content in both Content and Video collections
    let content = await Content.findById(id).lean();
    let isVideoContent = false;

    // If not found in Content, try Video collection
    if (!content) {
      content = await Video.findById(id).lean();
      isVideoContent = true;
    }

    if (!content) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Content not found" }, "Content not found")
        );
    }

    // Check if content is public (for video content)
    if (isVideoContent && content.isPublic === false) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Content is private" },
            "Content is private"
          )
        );
    }

    // Get engagement data
    const contentType = isVideoContent ? "video" : "content";
    const [likes, comments, shares] = await Promise.all([
      Like.countDocuments({ uid: content._id, type: contentType }),
      Comment.countDocuments({ uid: content._id, type: contentType }),
      Content.countDocuments({
        "originalContent._id": content._id,
        isShared: true,
      }),
    ]);

    // Check user interactions
    const [liked, commented, following] = await Promise.all([
      Like.findOne({
        uid: content._id,
        type: contentType,
        "user.email": user.email,
      }),
      Comment.findOne({
        uid: content._id,
        type: contentType,
        "user.email": user.email,
      }),
      Follow.findOne({
        "follower._id": user._id,
        "following._id": content.author._id,
      }),
    ]);

    // Prepare optimized content based on type
    let optimizedContent;

    if (isVideoContent) {
      // Video content optimization
      optimizedContent = {
        _id: content._id,
        title: content.title,
        description: content.description,
        type: content.type || "video",
        author: content.author,
        createdAt: content.createdAt,
        views: content.views || 0,
        duration: content.duration,
        tags: content.tags || [],
        category: content.category,
        quality: content.quality,
        aspectRatio: content.aspectRatio,

        // Video-specific data
        videoUrl: content.videoUrl,
        thumbnail: content.thumbnail,

        // Streaming optimization
        streamingUrls: {
          hls: generateHLSUrl(content.videoUrl),
          original: content.videoUrl,
          thumbnail:
            content.thumbnail || generateThumbnailUrl(content.videoUrl),
        },

        // Playback settings
        playbackSettings: {
          autoplay: false,
          muted: true,
          loop: content.type === "reel",
          preload: "metadata",
          controls: true,
          playsInline: true,
        },

        contentType: "video",
      };
    } else {
      // Regular content optimization
      const contentTypeDetected = determineContentType(content.files);

      optimizedContent = {
        _id: content._id,
        status: content.status,
        files: content.files || [],
        type: content.type,
        author: content.author,
        createdAt: content.createdAt,
        views: content.views || 0,
        isShared: content.isShared || false,
        originalContent: content.originalContent,
        shareText: content.shareText,

        // Optimized files with streaming support
        optimizedFiles: content.files
          ? content.files.map((file) => {
              const isVideo = hasVideoFiles([file]);
              const isImage = hasImageFiles([file]);

              if (isVideo) {
                return {
                  url: file,
                  type: "video",
                  hls: generateHLSUrl(file),
                  thumbnail: generateThumbnailUrl(file),
                  streaming: true,
                };
              } else if (isImage) {
                return {
                  url: file,
                  type: "image",
                  thumbnail: generateThumbnailUrl(file),
                  compressed: true,
                };
              }

              return {
                url: file,
                type: "other",
              };
            })
          : [],

        contentType: contentTypeDetected,
      };
    }

    // Add engagement data
    optimizedContent.engagement = {
      likes,
      comments,
      shares,
      liked: !!liked,
      commented: !!commented,
      following: !!following,
      engagementRate: calculateEngagementRate(
        likes,
        comments,
        shares,
        content.views || 0
      ),
    };

    // Add metadata
    optimizedContent.metadata = {
      canShare: true,
      canDownload: false,
      loadPriority: "high",
      isPublic: isVideoContent ? content.isPublic : true,
      processingStatus: isVideoContent ? content.processingStatus : "completed",
    };

    // Increment view count asynchronously
    setImmediate(async () => {
      try {
        const Model = isVideoContent ? Video : Content;
        await Model.updateOne(
          { _id: content._id },
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
          optimizedContent,
          null,
          `${isVideoContent ? "Video" : "Content"} retrieved successfully`
        )
      );
  } catch (error) {
    console.error("GetContentById error:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  GetContentById,
};
