const router = require("express").Router();
const { isValidObjectId } = require("mongoose");

const basicMiddleware = require("../../middlewares/basicMiddleware");
const {
  UpdateFollow,
  CheckFollowStatus,
  ListFollowers,
  ListFollowings,
  GetUsersFollowers,
  GetUsersFollowing,
} = require("./follow.methods");

// Validate ObjectId middleware
const validateObjectId = (req, res, next) => {
  mediator(req, res, next);
  const { id } = req.params;
  if (id && !isValidObjectId(id)) {
    return res.status(400).json({
      status: 400,
      error: "Invalid user ID",
      message: "Invalid user ID provided",
    });
  }
  next();
};

// Validate UpdateFollow request body
const validateUpdateFollow = (req, res, next) => {
  const { email, action } = req.body;
  if (!email || !action || !["follow", "unfollow"].includes(action)) {
    return res.status(400).json({
      status: 400,
      error: "Invalid request body",
      message: "Email and valid action (follow/unfollow) are required",
    });
  }
  next();
};

// Routes
router.post("/follow", basicMiddleware, validateUpdateFollow, UpdateFollow);
router.get("/check", basicMiddleware, CheckFollowStatus);
router.get("/list-followers", basicMiddleware, ListFollowers);
router.get("/list-followings", basicMiddleware, ListFollowings);
router.get(
  "/followers/:id",
  basicMiddleware,
  validateObjectId,
  GetUsersFollowers
);
router.get(
  "/following/:id",
  basicMiddleware,
  validateObjectId,
  GetUsersFollowing
);

module.exports = router;
