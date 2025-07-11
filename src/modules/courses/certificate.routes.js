const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const CertificateFiles = require("../../utils/fileProcessor/multer.certificates");
const {
  serveCertificate,
  uploadTemplate,
  generateCertificate,
  deleteCertificate,
  getCertificateStats,
} = require("./certificate.controller");

router.get("/certificates/generated/:type/:userId/:filename", serveCertificate);
router.post(
  "/admin/certificates/template",
  basicMiddleware,
  CertificateFiles.single("template"),
  uploadTemplate
);
router.post(
  "/admin/certificates/generate",
  basicMiddleware,
  generateCertificate
);
router.delete(
  "/admin/certificates/:certificateId",
  basicMiddleware,
  deleteCertificate
);
router.get("/admin/certificates/stats", basicMiddleware, getCertificateStats);

module.exports = router;
