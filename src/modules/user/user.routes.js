const basicMiddleware = require("../../middlewares/basicMiddleware");
const { registerMiddleware } = require("../../middlewares/firebaseMiddleware");
const UserFiles = require("../../utils/fileProcessor/multer.users");
const LoginUser = require("./user.login");
const {
  UserExist,
  UserProfile,
  NewOtp,
  SetPassword,
  SetAvatar,
  SetDetails,
  StalkProfile,
} = require("./user.methods");
const RegisterUser = require("./user.register");

const router = require("express").Router();

// get request
router.get("/user-exist", UserExist);
router.get("/user-profile", basicMiddleware, UserProfile);
router.get("/stalk-profile/:id", basicMiddleware, StalkProfile);

// post req
router.post("/register-user", registerMiddleware, RegisterUser);
router.post("/send-otp", NewOtp);
router.post("/forget-password", SetPassword);
router.post("/login", LoginUser);

// update reqs
router.post(
  "/set-avatar",
  basicMiddleware,
  UserFiles.single("avatar"),
  SetAvatar
);
router.post("/set-details", basicMiddleware, SetDetails);

// return router
module.exports = router;
