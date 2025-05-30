const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const {
  GetNotifications,
  MarkAsRead,
  MarkAllAsRead,
  DeleteNotification,
  DeleteAllNotifications,
} = require("./notification.methods");

router.get("/notifications", basicMiddleware, GetNotifications);
router.post("/notifications/mark-read", basicMiddleware, MarkAsRead);
router.post("/notifications/mark-all-read", basicMiddleware, MarkAllAsRead);
router.delete("/notifications/:id", basicMiddleware, DeleteNotification);
router.delete("/notifications", basicMiddleware, DeleteAllNotifications);

module.exports = router;
