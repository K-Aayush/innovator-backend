const { mkdirSync } = require("fs");
const multer = require("multer");
const path = require("path");

// Create Multer storage engine for videos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userEmail = req?.user?.email;
    const subfolder = req?.query?.subfolder || "videos";

    if (!userEmail) {
      return cb(new Error("User email not provided in request."), null);
    }

    // Full local path
    const fullPath = path.join(process.cwd(), "uploads", userEmail, subfolder);

    try {
      mkdirSync(fullPath, { recursive: true });
    } catch (err) {
      return cb(new Error(`Failed to create directory: ${err.message}`), null);
    }

    // Save server-relative destination path for use in filename
    req.destination = `/uploads/${userEmail}/${subfolder}`.replaceAll(
      "//",
      "/"
    );
    cb(null, fullPath);
  },

  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    const safeName =
      req?.query?.filename || `video-${timestamp}-${random}${ext}`;

    // Save final full relative path for use later
    req.file_location = `${req.destination}/${safeName}`.replaceAll("//", "/");

    cb(null, safeName);
  },
});

// File filter for videos only
const fileFilter = (req, file, cb) => {
  const allowedTypes = /mp4|avi|mov|wmv|flv|webm|mkv/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = file.mimetype.startsWith("video/");

  if (extname && mimetype) {
    return cb(null, true);
  }
  cb(new Error("Only video files are allowed"), false);
};

const VideoFiles = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter,
});

module.exports = VideoFiles;
