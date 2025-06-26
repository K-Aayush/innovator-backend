const router = require("express").Router();
const basicMiddleware = require("../../middlewares/basicMiddleware");
const UserFiles = require("../../utils/fileProcessor/multer.users");
const {
  CreateEvent,
  GetEvents,
  GetEventById,
  UpdateEvent,
  DeleteEvent,
  GetAdminEvents,
  UpdateEventStatus,
} = require("./event.methods");

// Public routes
router.get("/events", GetEvents);
router.get("/events/:id", GetEventById);

// Admin routes (require authentication)
router.post(
  "/admin/events",
  basicMiddleware,
  UserFiles.array("images", 5),
  CreateEvent
);

router.get("/admin/events", basicMiddleware, GetAdminEvents);

router.put(
  "/admin/events/:id",
  basicMiddleware,
  UserFiles.array("images", 5),
  UpdateEvent
);

router.delete("/admin/events/:id", basicMiddleware, DeleteEvent);

router.patch("/admin/events/:id/status", basicMiddleware, UpdateEventStatus);

module.exports = router;
