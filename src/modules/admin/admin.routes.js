const {
  AddVendor,
  GetUserStats,
  GetLeaderboard,
  BanUser,
  GetVendorStats,
  DeleteUserContent,
  HandleAdRequest,
  GetAdStats,
} = require("./admin.methods");
const basicMiddleware = require("../../middlewares/basicMiddleware");

const route = require("express").Router();

// Vendor management
route.post("/add-vendor", basicMiddleware, AddVendor);

// User statistics and management
route.get("/user-stats", basicMiddleware, GetUserStats);
route.get("/leaderboard", basicMiddleware, GetLeaderboard);
route.post("/ban-user", basicMiddleware, BanUser);
route.delete("/user-content", basicMiddleware, DeleteUserContent);

// Vendor statistics
route.get("/vendor-stats", basicMiddleware, GetVendorStats);

// Advertisement management
route.post("/handle-ad", basicMiddleware, HandleAdRequest);
route.get("/ad-stats", basicMiddleware, GetAdStats);

module.exports = route;
