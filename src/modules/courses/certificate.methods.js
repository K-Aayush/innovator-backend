const path = require("path");
const fs = require("fs");
const CertificateGenerator = require("./certificate.generator");
const Certificate = require("./certificate.model");
const GenRes = require("../../utils/routers/GenRes");

async function serveCertificate(req, res) {
  try {
    const { type, userId, filename } = req.params;

    const safePath = path.join(
      process.cwd(),
      "certificates",
      "generated",
      type,
      userId,
      filename
    );

    const normalizedPath = path.normalize(safePath);
    const certificatesDir = path.join(
      process.cwd(),
      "certificates",
      "generated"
    );

    if (!normalizedPath.startsWith(certificatesDir)) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Access denied" },
            "Unauthorized file access"
          )
        );
    }

    if (!fs.existsSync(normalizedPath)) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Certificate not found" },
            "Certificate file not found"
          )
        );
    }

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.sendFile(normalizedPath);
  } catch (error) {
    console.error("Error serving certificate:", error);
    res.status(500).json(GenRes(500, null, error, error.message));
  }
}

async function uploadTemplate(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can upload templates"
          )
        );
    }

    const templateFile = req.file_location;
    if (!templateFile) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Template file required" },
            "Please upload a template file"
          )
        );
    }

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { templateUrl: templateFile },
          null,
          "Template uploaded successfully"
        )
      );
  } catch (error) {
    console.error("Error uploading certificate template:", error);
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
}

async function generateCertificate(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can generate certificates"
          )
        );
    }

    const { studentId, certificateData, certificateType = "course" } = req.body;

    if (!studentId || !certificateData) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Missing required data" },
            "Student ID and certificate data required"
          )
        );
    }

    const certificateDir = path.join(
      process.cwd(),
      "certificates",
      "generated",
      certificateType,
      studentId
    );

    const result = await CertificateGenerator.saveCertificateFile(
      certificateData,
      certificateDir,
      certificateType
    );

    if (result.success) {
      return res
        .status(200)
        .json(GenRes(200, result, null, "Certificate generated successfully"));
    } else {
      return res
        .status(500)
        .json(
          GenRes(
            500,
            null,
            { error: result.error },
            "Failed to generate certificate"
          )
        );
    }
  } catch (error) {
    console.error("Error generating certificate:", error);
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
}

async function deleteCertificate(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete certificates"
          )
        );
    }

    const { certificateId } = req.params;
    const { certificateType = "course" } = req.query;

    const deletedCert = await Certificate.findOneAndDelete({ certificateId });

    if (!deletedCert) {
      return res
        .status(404)
        .json(
          GenRes(
            404,
            null,
            { error: "Certificate not found" },
            "Certificate not found in database"
          )
        );
    }

    const deleteResult = await CertificateGenerator.deleteCertificate(
      certificateId,
      certificateType
    );

    return res.status(200).json(
      GenRes(
        200,
        {
          databaseDeleted: true,
          fileDeleted: deleteResult.success,
          fileError: deleteResult.error || null,
        },
        null,
        "Certificate deleted successfully"
      )
    );
  } catch (error) {
    console.error("Error deleting certificate:", error);
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
}

async function getCertificateStats(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can view certificate stats"
          )
        );
    }

    const stats = await Certificate.aggregate([
      {
        $group: {
          _id: null,
          totalCertificates: { $sum: 1 },
          courseCertificates: {
            $sum: {
              $cond: [{ $eq: ["$course.title", { $type: "string" }] }, 1, 0],
            },
          },
          thisMonth: {
            $sum: {
              $cond: [
                {
                  $gte: [
                    "$certificate.issuedAt",
                    new Date(
                      new Date().getFullYear(),
                      new Date().getMonth(),
                      1
                    ),
                  ],
                },
                1,
                0,
              ],
            },
          },
          thisWeek: {
            $sum: {
              $cond: [
                {
                  $gte: [
                    "$certificate.issuedAt",
                    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    return res.status(200).json(
      GenRes(
        200,
        stats[0] || {
          totalCertificates: 0,
          courseCertificates: 0,
          thisMonth: 0,
          thisWeek: 0,
        },
        null,
        "Certificate statistics retrieved"
      )
    );
  } catch (error) {
    console.error("Error getting certificate stats:", error);
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
}

module.exports = {
  serveCertificate,
  uploadTemplate,
  generateCertificate,
  deleteCertificate,
  getCertificateStats,
};
