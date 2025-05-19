const { mkdirSync } = require("fs");
const multer = require("multer");
const path = require("path");

// Create Multer storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userEmail = req?.vendor?.email;
    const subfolder = req?.query?.subfolder || "";

    if (!userEmail) {
      return cb(new Error("Vendor email not provided in request."), null);
    }

    // Full local path
    const fullPath = path.join(
      process.cwd(),
      "uploads",
      userEmail,
      "shop",
      subfolder
    );

    try {
      mkdirSync(fullPath, { recursive: true });
    } catch (err) {
      return cb(new Error(`Failed to create directory: ${err.message}`), null);
    }

    // Save server-relative destination path for use in filename
    req.destination = `/uploads/${userEmail}/shop/${subfolder}`.replaceAll(
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
      req?.query?.filename || `${file.fieldname}-${timestamp}-${random}${ext}`;

    const fileLocation = `${req.destination}/${safeName}`.replaceAll("//", "/");
    req.file_locations = req.file_locations || [];
    req.file_locations.push(fileLocation);

    cb(null, safeName);
  },
});

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }
  cb(new Error("Only image files (JPEG, PNG, GIF) are allowed"), false);
};

const ShopFile = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, 
  fileFilter,
});

module.exports = ShopFile;
