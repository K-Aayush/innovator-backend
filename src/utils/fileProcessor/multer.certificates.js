const { mkdirSync } = require("fs");
const multer = require("multer");
const path = require("path");

// Create Multer storage engine for certificates
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const certificateType = req?.query?.certificateType || "course";
    const userId = req?.user?._id || "system";

    // Create certificates directory structure
    const fullPath = path.join(
      process.cwd(),
      "certificates",
      "generated",
      certificateType,
      userId
    );

    try {
      mkdirSync(fullPath, { recursive: true });
    } catch (err) {
      return cb(
        new Error(`Failed to create certificate directory: ${err.message}`),
        null
      );
    }

    // Save server-relative destination path for use in filename
    req.destination =
      `/certificates/generated/${certificateType}/${userId}`.replaceAll(
        "//",
        "/"
      );
    cb(null, fullPath);
  },

  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const certificateId = req?.body?.certificateId || `CERT-${timestamp}`;
    const ext = path.extname(file.originalname) || ".html";
    const safeName = `${certificateId}${ext}`;

    // Save final full relative path for use later
    const filePath = `${req.destination}/${safeName}`.replaceAll("//", "/");
    req.file_location = filePath;

    const oldLocations = Array.isArray(req?.file_locations)
      ? req?.file_locations
      : [];
    oldLocations.push(filePath);
    req.file_locations = oldLocations;

    console.log(
      "Saving certificate to:",
      path.join(process.cwd(), filePath.substring(1))
    );
    console.log("Certificate file path:", filePath);

    cb(null, safeName);
  },
});

// File filter for certificates (HTML, PDF, etc.)
const fileFilter = (req, file, cb) => {
  const allowedTypes = /html|pdf|png|jpg|jpeg/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype =
    allowedTypes.test(file.mimetype) || file.mimetype === "text/html";

  if (extname && (mimetype || file.mimetype === "text/html")) {
    return cb(null, true);
  }
  cb(
    new Error("Only HTML, PDF, and image files are allowed for certificates"),
    false
  );
};

const CertificateFiles = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, 
  fileFilter,
});

module.exports = CertificateFiles;
