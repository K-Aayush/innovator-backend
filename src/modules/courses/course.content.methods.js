const Course = require("./courses.model");
const User = require("../user/user.model");
const GenRes = require("../../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");
const path = require("path");
const fs = require("fs");

// Get course PDFs
const GetCoursePDFs = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { page = 0, limit = 10 } = req.query;
    const user = req.user;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Course.findById(courseId).lean();
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Check if user has access (you can implement payment/enrollment logic here)
    const hasAccess = await checkCourseAccess(user._id, courseId);

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = pageNum * limitNum;
    const endIndex = startIndex + limitNum;

    // Filter PDFs from notes
    const pdfNotes = course.notes.filter(
      (note) => note.pdf && note.pdf.toLowerCase().endsWith(".pdf")
    );

    // Apply pagination
    const paginatedPDFs = pdfNotes.slice(startIndex, endIndex);

    // Process PDFs based on access level
    const processedPDFs = paginatedPDFs.map((note) => {
      const isAccessible = hasAccess || !note.premium;

      return {
        _id: note._id,
        name: note.name,
        pdf: isAccessible ? note.pdf : null,
        premium: note.premium,
        accessible: isAccessible,
        preview: isAccessible
          ? null
          : "Premium content - Purchase course to access",
        fileSize: isAccessible ? getFileSize(note.pdf) : null,
        downloadUrl: isAccessible
          ? `/api/v1/courses/download-pdf/${courseId}/${note._id}`
          : null,
      };
    });

    return res.status(200).json(
      GenRes(
        200,
        {
          course: {
            _id: course._id,
            title: course.title,
            description: course.description,
            thumbnail: course.thumbnail,
          },
          pdfs: processedPDFs,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: pdfNotes.length,
            pages: Math.ceil(pdfNotes.length / limitNum),
            hasMore: endIndex < pdfNotes.length,
          },
          userAccess: {
            hasFullAccess: hasAccess,
            accessibleCount: processedPDFs.filter((pdf) => pdf.accessible)
              .length,
            totalCount: pdfNotes.length,
          },
        },
        null,
        "Course PDFs retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error getting course PDFs:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get course videos
const GetCourseVideos = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { page = 0, limit = 10, quality = "medium" } = req.query;
    const user = req.user;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const course = await Course.findById(courseId).lean();
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const hasAccess = await checkCourseAccess(user._id, courseId);

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = pageNum * limitNum;
    const endIndex = startIndex + limitNum;

    // Filter video files from notes
    const videoNotes = course.notes.filter(
      (note) => note.pdf && isVideoFile(note.pdf)
    );

    const paginatedVideos = videoNotes.slice(startIndex, endIndex);

    const processedVideos = paginatedVideos.map((note) => {
      const isAccessible = hasAccess || !note.premium;

      return {
        _id: note._id,
        name: note.name,
        video: isAccessible ? note.pdf : null, // pdf field contains video path
        premium: note.premium,
        accessible: isAccessible,
        preview: isAccessible
          ? null
          : "Premium content - Purchase course to access",
        thumbnail: isAccessible ? generateVideoThumbnail(note.pdf) : null,
        duration: isAccessible ? getVideoDuration(note.pdf) : null,
        streamingUrls: isAccessible
          ? generateStreamingUrls(note.pdf, quality)
          : null,
        downloadUrl: isAccessible
          ? `/api/v1/courses/download-video/${courseId}/${note._id}`
          : null,
      };
    });

    return res.status(200).json(
      GenRes(
        200,
        {
          course: {
            _id: course._id,
            title: course.title,
            description: course.description,
            thumbnail: course.thumbnail,
          },
          videos: processedVideos,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: videoNotes.length,
            pages: Math.ceil(videoNotes.length / limitNum),
            hasMore: endIndex < videoNotes.length,
          },
          userAccess: {
            hasFullAccess: hasAccess,
            accessibleCount: processedVideos.filter((video) => video.accessible)
              .length,
            totalCount: videoNotes.length,
          },
        },
        null,
        "Course videos retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error getting course videos:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Download PDF
const DownloadPDF = async (req, res) => {
  try {
    const { courseId, noteId } = req.params;
    const user = req.user;

    if (!isValidObjectId(courseId) || !isValidObjectId(noteId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or note ID"
          )
        );
    }

    const course = await Course.findById(courseId).lean();
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const note = course.notes.find((n) => n._id.toString() === noteId);
    if (!note || !note.pdf.toLowerCase().endsWith(".pdf")) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "PDF not found" }, "PDF not found"));
    }

    const hasAccess = await checkCourseAccess(user._id, courseId);
    if (!hasAccess && note.premium) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Access denied" },
            "Premium content requires course purchase"
          )
        );
    }

    const filePath = path.join(process.cwd(), note.pdf.substring(1));

    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "File not found" },
            "PDF file not found on server"
          )
        );
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${note.name}.pdf"`
    );

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("Error downloading PDF:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Download Video
const DownloadVideo = async (req, res) => {
  try {
    const { courseId, noteId } = req.params;
    const user = req.user;

    if (!isValidObjectId(courseId) || !isValidObjectId(noteId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid IDs" },
            "Invalid course or note ID"
          )
        );
    }

    const course = await Course.findById(courseId).lean();
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    const note = course.notes.find((n) => n._id.toString() === noteId);
    if (!note || !isVideoFile(note.pdf)) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Video not found" }, "Video not found")
        );
    }

    const hasAccess = await checkCourseAccess(user._id, courseId);
    if (!hasAccess && note.premium) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Access denied" },
            "Premium content requires course purchase"
          )
        );
    }

    const filePath = path.join(process.cwd(), note.pdf.substring(1));

    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "File not found" },
            "Video file not found on server"
          )
        );
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Support video streaming with range requests
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "video/mp4",
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${note.name}.mp4"`,
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error("Error downloading video:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Helper functions
async function checkCourseAccess(userId, courseId) {
  return false;
}

function getFileSize(filePath) {
  try {
    const fullPath = path.join(process.cwd(), filePath.substring(1));
    const stats = fs.statSync(fullPath);
    return formatFileSize(stats.size);
  } catch (error) {
    return "Unknown";
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function isVideoFile(filePath) {
  const videoExtensions = [
    ".mp4",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".mkv",
  ];
  const ext = path.extname(filePath).toLowerCase();
  return videoExtensions.includes(ext);
}

function generateVideoThumbnail(videoPath) {
  // Generate thumbnail path based on video path
  const basePath = videoPath.replace(/\.[^/.]+$/, "");
  return `${basePath}_thumbnail.jpg`;
}

function getVideoDuration(videoPath) {
  return "00:00:00";
}

function generateStreamingUrls(videoPath, quality) {
  const basePath = videoPath.replace(/\.[^/.]+$/, "");

  return {
    hls: `${basePath}/playlist.m3u8`,
    dash: `${basePath}/manifest.mpd`,
    qualities: {
      "360p": `${basePath}/360p/playlist.m3u8`,
      "480p": `${basePath}/480p/playlist.m3u8`,
      "720p": `${basePath}/720p/playlist.m3u8`,
      "1080p": `${basePath}/1080p/playlist.m3u8`,
    },
    thumbnail: generateVideoThumbnail(videoPath),
  };
}

module.exports = {
  GetCoursePDFs,
  GetCourseVideos,
  DownloadPDF,
  DownloadVideo,
};
