const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const CourseRating = require("./rating.model");
const Course = require("./courses.model");
const Enrollment = require("./enrollment.model");
const User = require("../user/user.model");
const Notification = require("../notifications/notification.model");
const FCMHandler = require("../../utils/notification/fcmHandler");

// Submit course rating and review
const SubmitCourseRating = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      rating,
      review = {},
      deviceType,
      platform,
      wouldRecommend = true,
      difficultyLevel,
      valueForMoney,
    } = req.body;
    const userId = req.user._id;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid rating" },
            "Rating must be between 1 and 5 stars"
          )
        );
    }

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    // Check if course exists
    const course = await Course.findById(courseId).select("title author price");
    if (!course) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Course not found" }, "Course not found")
        );
    }

    // Check if user is enrolled
    const enrollment = await Enrollment.findOne({
      "student._id": userId,
      "course._id": courseId,
    });

    if (!enrollment) {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not enrolled" },
            "You must be enrolled to rate this course"
          )
        );
    }

    const isFree = !course.price?.usd || course.price.usd === 0;
    const minimumProgress = isFree ? 0 : 25;

    if (enrollment.progress.completionPercentage < minimumProgress) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Insufficient progress" },
            `Complete at least ${minimumProgress}% of the course to submit a rating`
          )
        );
    }

    // Get user details
    const user = await User.findById(userId).select("email name picture");

    // Check if user already rated this course
    const existingRating = await CourseRating.findOne({
      "course._id": courseId,
      "student._id": userId,
    });

    let courseRating;

    if (existingRating) {
      // Update existing rating
      existingRating.rating = rating;
      existingRating.review = review;
      existingRating.wouldRecommend = wouldRecommend;
      existingRating.difficultyLevel = difficultyLevel;
      existingRating.valueForMoney = valueForMoney;
      existingRating.courseProgress = {
        completionPercentage: enrollment.progress.completionPercentage,
        timeSpent: enrollment.progress.totalTimeSpent,
      };
      existingRating.metadata = {
        deviceType,
        platform,
        courseVersion: "1.0",
        isFree,
      };

      courseRating = await existingRating.save();
    } else {
      // Create new rating
      courseRating = new CourseRating({
        course: {
          _id: courseId,
          title: course.title,
          author: course.author,
        },
        student: {
          _id: userId,
          email: user.email,
          name: user.name,
          picture: user.picture,
        },
        rating,
        review,
        wouldRecommend,
        difficultyLevel,
        valueForMoney,
        verified: true, // Since they're enrolled
        courseProgress: {
          completionPercentage: enrollment.progress.completionPercentage,
          timeSpent: enrollment.progress.totalTimeSpent,
        },
        metadata: {
          deviceType,
          platform,
          courseVersion: "1.0",
          isFree,
        },
      });

      await courseRating.save();
    }

    // Update course rating statistics
    await updateCourseRatingStats(courseId);

    // Create notification for course author
    const notification = new Notification({
      recipient: {
        _id: course.author._id,
        email: course.author.email,
      },
      sender: {
        _id: userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      type: "course",
      content: `${user.name} rated your course "${course.title}" ${rating} stars`,
      metadata: {
        itemId: courseId,
        itemType: "course",
        ratingId: courseRating._id.toString(),
        rating,
      },
    });

    await notification.save();

    // Send FCM notification to course author
    try {
      await FCMHandler.sendToUser(course.author._id, {
        title: "New Course Rating",
        body: `${user.name} gave ${rating} stars to "${course.title}"`,
        type: "course_rating",
        data: {
          courseId,
          ratingId: courseRating._id.toString(),
          rating: rating.toString(),
        },
      });
    } catch (fcmError) {
      console.error("Failed to send FCM notification:", fcmError);
    }

    return res
      .status(200)
      .json(GenRes(200, courseRating, null, "Rating submitted successfully"));
  } catch (error) {
    console.error("Error submitting course rating:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get course ratings with enhanced filtering
const GetCourseRatings = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      page = 0,
      limit = 10,
      rating,
      sortBy = "createdAt",
      sortOrder = "desc",
      verified,
      withReviews = false,
    } = req.query;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const pageNum = parseInt(page, 10) || 0;
    const limitNum = Math.min(parseInt(limit, 10) || 10, 50);

    // Build filters
    const filters = {
      "course._id": courseId,
      status: "active",
    };

    if (rating) {
      filters.rating = parseInt(rating);
    }

    if (verified === "true") {
      filters.verified = true;
    }

    if (withReviews === "true") {
      filters["review.content"] = { $exists: true, $ne: "" };
    }

    const sortDirection = sortOrder === "desc" ? -1 : 1;
    const sortObj = { [sortBy]: sortDirection };

    const [ratings, total, ratingStats] = await Promise.all([
      CourseRating.find(filters)
        .sort(sortObj)
        .skip(pageNum * limitNum)
        .limit(limitNum)
        .lean(),
      CourseRating.countDocuments(filters),
      CourseRating.aggregate([
        { $match: { "course._id": courseId, status: "active" } },
        {
          $group: {
            _id: "$rating",
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
      ]),
    ]);

    // Calculate rating distribution
    const ratingDistribution = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    };

    ratingStats.forEach((stat) => {
      ratingDistribution[stat._id] = stat.count;
    });

    const totalRatings = Object.values(ratingDistribution).reduce(
      (a, b) => a + b,
      0
    );
    const averageRating =
      totalRatings > 0
        ? ratingStats.reduce((sum, stat) => sum + stat._id * stat.count, 0) /
          totalRatings
        : 0;

    // Calculate additional statistics
    const recommendationRate =
      (await CourseRating.countDocuments({
        "course._id": courseId,
        wouldRecommend: true,
      })) / Math.max(totalRatings, 1);

    // Enrich ratings with helpful status for current user
    const enrichedRatings = ratings.map((rating) => ({
      ...rating,
      isHelpful: req.user ? rating.helpful.users.includes(req.user._id) : false,
      timeSinceRating: getTimeSinceRating(rating.createdAt),
    }));

    return res.status(200).json(
      GenRes(
        200,
        {
          ratings: enrichedRatings,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum),
            hasMore: (pageNum + 1) * limitNum < total,
          },
          statistics: {
            averageRating: Math.round(averageRating * 10) / 10,
            totalRatings,
            ratingDistribution,
            verifiedCount: ratings.filter((r) => r.verified).length,
            recommendationRate: Math.round(recommendationRate * 100),
            reviewsCount: ratings.filter((r) => r.review?.content).length,
          },
        },
        null,
        `Retrieved ${ratings.length} ratings`
      )
    );
  } catch (error) {
    console.error("Error getting course ratings:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Mark rating as helpful
const MarkRatingHelpful = async (req, res) => {
  try {
    const { ratingId } = req.params;
    const { helpful = true } = req.body;
    const userId = req.user._id;

    if (!isValidObjectId(ratingId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid rating ID" }, "Invalid rating ID")
        );
    }

    const rating = await CourseRating.findById(ratingId);
    if (!rating) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Rating not found" }, "Rating not found")
        );
    }

    const userIndex = rating.helpful.users.indexOf(userId);

    if (helpful) {
      if (userIndex === -1) {
        rating.helpful.users.push(userId);
        rating.helpful.count += 1;
      }
    } else {
      if (userIndex !== -1) {
        rating.helpful.users.splice(userIndex, 1);
        rating.helpful.count = Math.max(0, rating.helpful.count - 1);
      }
    }

    await rating.save();

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { helpful: rating.helpful },
          null,
          helpful ? "Marked as helpful" : "Removed helpful mark"
        )
      );
  } catch (error) {
    console.error("Error marking rating as helpful:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Get user's rating for a course
const GetUserCourseRating = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const rating = await CourseRating.findOne({
      "course._id": courseId,
      "student._id": userId,
    }).lean();

    if (!rating) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Rating not found" }, "No rating found")
        );
    }

    return res
      .status(200)
      .json(GenRes(200, rating, null, "User rating retrieved successfully"));
  } catch (error) {
    console.error("Error getting user course rating:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Delete user's rating
const DeleteCourseRating = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id;

    if (!isValidObjectId(courseId)) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Invalid course ID" }, "Invalid course ID")
        );
    }

    const deletedRating = await CourseRating.findOneAndDelete({
      "course._id": courseId,
      "student._id": userId,
    });

    if (!deletedRating) {
      return res
        .status(404)
        .json(
          GenRes(404, null, { error: "Rating not found" }, "No rating found")
        );
    }

    await updateCourseRatingStats(courseId);

    return res
      .status(200)
      .json(GenRes(200, null, null, "Rating deleted successfully"));
  } catch (error) {
    console.error("Error deleting course rating:", error);
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// Helper function to update course rating statistics
async function updateCourseRatingStats(courseId) {
  try {
    const ratingStats = await CourseRating.aggregate([
      { $match: { "course._id": courseId, status: "active" } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalRatings: { $sum: 1 },
          recommendationRate: {
            $avg: { $cond: ["$wouldRecommend", 1, 0] },
          },
          ratingDistribution: {
            $push: "$rating",
          },
        },
      },
    ]);

    if (ratingStats.length > 0) {
      const stats = ratingStats[0];
      await Course.findByIdAndUpdate(courseId, {
        $set: {
          "rating.average": Math.round(stats.averageRating * 10) / 10,
          "rating.count": stats.totalRatings,
          "rating.recommendationRate": Math.round(
            stats.recommendationRate * 100
          ),
        },
      });
    } else {
      await Course.findByIdAndUpdate(courseId, {
        $set: {
          "rating.average": 0,
          "rating.count": 0,
          "rating.recommendationRate": 0,
        },
      });
    }
  } catch (error) {
    console.error("Error updating course rating stats:", error);
  }
}

function getTimeSinceRating(createdAt) {
  const now = new Date();
  const diffTime = Math.abs(now - createdAt);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

module.exports = {
  SubmitCourseRating,
  GetCourseRatings,
  MarkRatingHelpful,
  GetUserCourseRating,
  DeleteCourseRating,
};
