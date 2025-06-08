const { mkdirSync } = require("fs");
const multer = require("multer");
const path = require("path");

// Unified storage engine for both videos and thumbnails
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userEmail = req?.user?.email;
    const subfolder =
      req?.query?.subfolder ||
      (file.mimetype.startsWith("video/") ? "videos" : "images");

    if (!userEmail) {
      return cb(new Error("User email not provided in request."), null);
    }

    const fullPath = path.join(process.cwd(), "uploads", userEmail, subfolder);

    try {
      mkdirSync(fullPath, { recursive: true });
    } catch (err) {
      return cb(new Error(`Failed to create directory: ${err.message}`), null);
    }

    // Save destination path for later use
    req.destinations = req.destinations || {};
    req.destinations[file.fieldname] =
      `/uploads/${userEmail}/${subfolder}`.replaceAll("//", "/");

    cb(null, fullPath);
  },

  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    const defaultName = `${file.fieldname}-${timestamp}-${random}${ext}`;
    const safeName = req?.query?.[`${file.fieldname}Name`] || defaultName;

    // Save location for later use in controller
    req.file_locations = req.file_locations || {};
    req.file_locations[file.fieldname] = `${
      req.destinations[file.fieldname]
    }/${safeName}`.replaceAll("//", "/");

    cb(null, safeName);
  },
});

// File filter for videos and images
const fileFilter = (req, file, cb) => {
  const isVideo = file.mimetype.startsWith("video/");
  const isImage = file.mimetype.startsWith("image/");

  const videoTypes = /mp4|avi|mov|wmv|flv|webm|mkv/;
  const imageTypes = /jpeg|jpg|png|gif/;
  const ext = path.extname(file.originalname).toLowerCase();

  if (isVideo && videoTypes.test(ext)) return cb(null, true);
  if (isImage && imageTypes.test(ext)) return cb(null, true);

  return cb(new Error("Only video and image files are allowed"), false);
};

const uploadVideoAndThumbnail = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max, applies per file
  },
  fileFilter,
});

module.exports = uploadVideoAndThumbnail;
