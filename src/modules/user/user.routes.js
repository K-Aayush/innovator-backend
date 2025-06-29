const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const {
  optionalFirebaseMiddleware,
} = require("../../middlewares/firebaseMiddleware");
const UserFiles = require("../../utils/fileProcessor/multer.users");
const LoginUser = require("./user.login");
const ChangePassword = require("./user.changePassword");
const {
  UserExist,
  UserProfile,
  NewOtp,
  SetPassword,
  SetAvatar,
  SetDetails,
  StalkProfile,
  GetAllUsers,
  UpdateFCMToken,
  SubmitReport,
  SubmitSupport,
  GetUserReports,
  GetUserSupport,
  GetUserContent,
} = require("./user.methods");
const {
  BlockUser,
  UnblockUser,
  GetBlockedUsers,
  CheckBlockStatus,
  GetUsersWhoBlockedMe,
  checkBlockStatus,
} = require("./block.methods");
const RegisterUser = require("./user.register");

// get request
router.get("/user-exist", UserExist);
router.get("/users", GetAllUsers);
router.get("/user-profile", basicMiddleware, UserProfile);
router.get("/stalk-profile/:id", basicMiddleware, StalkProfile);
router.get("/getUserContent/:id", basicMiddleware, GetUserContent);

// post req
router.post("/register-user", RegisterUser);
router.post("/send-otp", NewOtp);
router.post("/forget-password", SetPassword);
router.post("/login", optionalFirebaseMiddleware, LoginUser);

// update reqs
router.post(
  "/set-avatar",
  basicMiddleware,
  UserFiles.single("avatar"),
  SetAvatar
);
router.post("/set-details", basicMiddleware, SetDetails);

// Change password
router.post("/change-password", basicMiddleware, ChangePassword);

// FCM token route
router.post("/update-fcm-token", basicMiddleware, UpdateFCMToken);

// Report and Support routes
router.post("/report", basicMiddleware, SubmitReport);
router.post("/support", basicMiddleware, SubmitSupport);
router.get("/reports", basicMiddleware, GetUserReports);
router.get("/support-tickets", basicMiddleware, GetUserSupport);

// Blocking system routes
router.post("/block-user", basicMiddleware, BlockUser);
router.post("/unblock-user", basicMiddleware, UnblockUser);
router.get("/blocked-users", basicMiddleware, GetBlockedUsers);
router.get("/check-block-status", basicMiddleware, CheckBlockStatus);
router.get("/users-who-blocked-me", basicMiddleware, GetUsersWhoBlockedMe);

module.exports = router;
