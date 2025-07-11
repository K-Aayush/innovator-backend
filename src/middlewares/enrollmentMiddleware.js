const SubcategoryEnrollment = require("../modules/courses/subcategory.enrollment.model");
const GenRes = require("../utils/routers/GenRes");
const { isValidObjectId } = require("mongoose");

const checkSubcategoryEnrollment = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const { subcategoryId, courseId } = req.params;

    if (!userId) {
      return res
        .status(401)
        .json(
          GenRes(
            401,
            null,
            { error: "Authentication required" },
            "Please login to access content"
          )
        );
    }

    let targetSubcategoryId = subcategoryId;

    // If courseId is provided, get subcategory from course
    if (courseId && !subcategoryId) {
      const EnhancedCourse = require("../modules/courses/course.enhanced.model");
      const course = await EnhancedCourse.findById(courseId).select(
        "subcategory"
      );

      if (!course) {
        return res
          .status(404)
          .json(
            GenRes(404, null, { error: "Course not found" }, "Course not found")
          );
      }

      targetSubcategoryId = course.subcategory._id;
    }

    if (!targetSubcategoryId || !isValidObjectId(targetSubcategoryId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid subcategory ID" },
            "Invalid subcategory ID"
          )
        );
    }

    // Check enrollment
    const enrollment = await SubcategoryEnrollment.findOne({
      "student._id": userId,
      "subcategory._id": targetSubcategoryId,
      status: "active",
    }).lean();

    if (!enrollment) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Enrollment required" },
            "You must be enrolled in this subcategory to access content"
          )
        );
    }

    // Check access permissions
    if (
      !enrollment.accessSettings.canAccessVideos &&
      req.path.includes("video")
    ) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Video access denied" },
            "Video access is not enabled for your enrollment"
          )
        );
    }

    if (
      !enrollment.accessSettings.canAccessNotes &&
      req.path.includes("note")
    ) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Notes access denied" },
            "Notes access is not enabled for your enrollment"
          )
        );
    }

    req.enrollment = enrollment;
    next();
  } catch (error) {
    console.error("Error in enrollment middleware:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Middleware to check if user can download content
const checkDownloadPermission = async (req, res, next) => {
  try {
    const enrollment = req.enrollment;

    if (!enrollment) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Enrollment required" },
            "Enrollment required for download"
          )
        );
    }

    if (!enrollment.accessSettings.canDownloadContent) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Download not allowed" },
            "Download permission is not enabled for your enrollment"
          )
        );
    }

    next();
  } catch (error) {
    console.error("Error in download permission middleware:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Optional enrollment check (doesn't block access but provides enrollment info)
const optionalEnrollmentCheck = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const { subcategoryId, courseId } = req.params;

    if (!userId) {
      req.enrollment = null;
      return next();
    }

    let targetSubcategoryId = subcategoryId;

    if (courseId && !subcategoryId) {
      const EnhancedCourse = require("../modules/courses/course.enhanced.model");
      const course = await EnhancedCourse.findById(courseId).select(
        "subcategory"
      );

      if (course) {
        targetSubcategoryId = course.subcategory._id;
      }
    }

    if (targetSubcategoryId && isValidObjectId(targetSubcategoryId)) {
      const enrollment = await SubcategoryEnrollment.findOne({
        "student._id": userId,
        "subcategory._id": targetSubcategoryId,
        status: "active",
      }).lean();

      req.enrollment = enrollment;
    } else {
      req.enrollment = null;
    }

    next();
  } catch (error) {
    console.error("Error in optional enrollment middleware:", error);
    req.enrollment = null;
    next();
  }
};

module.exports = {
  checkSubcategoryEnrollment,
  checkDownloadPermission,
  optionalEnrollmentCheck,
};
