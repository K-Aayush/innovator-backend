const { mkdirSync } = require("fs");
const multer = require("multer");
const path = require("path");
const HLSProcessor = require("../media/hlsProcessor");

// Create Multer storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userEmail = req?.user?.email;
    const subfolder = req?.query?.subfolder || "";

    if (!userEmail) {
      return cb(new Error("User email not provided in request."), null);
    }

    // Full local path
    const fullPath = path.join(process.cwd(), "uploads", userEmail, subfolder);

    try {
      mkdirSync(fullPath, { recursive: true });

      // Create additional directories for optimized content
      mkdirSync(path.join(fullPath, "thumbnails"), { recursive: true });
      mkdirSync(path.join(fullPath, "compressed"), { recursive: true });
      mkdirSync(path.join(fullPath, "hls"), { recursive: true });
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

  filename: async (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    const safeName =
      req?.query?.filename || `${file.fieldname}-${timestamp}-${random}${ext}`;

    // Save final full relative path for use later
    const filePath = `${req.destination}/${safeName}`.replaceAll("//", "/");
    req.file_location = filePath;

    const oldlocations = Array?.isArray(req?.file_locations)
      ? req?.file_locations
      : [];
    oldlocations.push(filePath);
    req.file_locations = oldlocations;

    // Process media files asynchronously after upload
    const fullFilePath = path.join(process.cwd(), filePath.substring(1));

    // Schedule background processing for content model files
    setImmediate(async () => {
      try {
        const isVideo = /\.(mp4|mov|avi|webm|mkv)$/i.test(ext);
        const isImage = /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(ext);

        if (isVideo) {
          // Generate HLS playlist and thumbnail for content model videos
          const hlsDir = path.join(
            path.dirname(fullFilePath),
            "hls",
            path.basename(safeName, ext)
          );
          const thumbnailPath = path.join(
            path.dirname(fullFilePath),
            "thumbnails",
            `${path.basename(safeName, ext)}_thumb.jpg`
          );

          console.log(`Processing video for content model: ${fullFilePath}`);
          console.log(`HLS output directory: ${hlsDir}`);
          console.log(`Thumbnail output: ${thumbnailPath}`);

          await Promise.all([
            HLSProcessor.generateMultiQualityHLS(fullFilePath, hlsDir).catch(
              (error) => {
                console.error("HLS generation failed:", error);
              }
            ),
            HLSProcessor.generateThumbnail(fullFilePath, thumbnailPath).catch(
              (error) => {
                console.error("Thumbnail generation failed:", error);
              }
            ),
          ]);

          console.log(`Video processing completed for: ${safeName}`);
        } else if (isImage) {
          // Generate compressed version and thumbnail
          const compressedPath = path.join(
            path.dirname(fullFilePath),
            "compressed",
            `${path.basename(safeName, ext)}_compressed.jpg`
          );
          const thumbnailPath = path.join(
            path.dirname(fullFilePath),
            "thumbnails",
            `${path.basename(safeName, ext)}_thumb.jpg`
          );

          await Promise.all([
            HLSProcessor.compressImage(fullFilePath, compressedPath, 75).catch(
              (error) => {
                console.error("Image compression failed:", error);
              }
            ),
            HLSProcessor.compressImage(fullFilePath, thumbnailPath, 60).catch(
              (error) => {
                console.error("Thumbnail generation failed:", error);
              }
            ),
          ]);

          console.log(`Image processing completed for: ${safeName}`);
        }
      } catch (error) {
        console.error("Background media processing error:", error);
      }
    });

    cb(null, safeName);
  },
});

const UserFiles = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB for content model files
    files: 5, // Limit number of files
  },
  fileFilter: (req, file, cb) => {
    // Allow only specific file types for content model
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm|mkv/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only images and videos are allowed for content"), false);
  },
});

module.exports = UserFiles;
