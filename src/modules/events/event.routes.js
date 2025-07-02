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
const {
  RegisterForEvent,
  GetUserRegistrations,
  GetEventRegistrations,
  UpdateRegistrationStatus,
  CheckInAttendee,
  CancelRegistration,
} = require("./eventRegistration.methods");

// Public routes
router.get("/events", GetEvents);
router.get("/events/:id", GetEventById);

// Event Registration routes
router.post("/events/:eventId/register", basicMiddleware, RegisterForEvent);
router.get("/my-registrations", basicMiddleware, GetUserRegistrations);
router.get("/registrations", GetUserRegistrations);
router.delete(
  "/registrations/:registrationId/cancel",
  basicMiddleware,
  CancelRegistration
);

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

// Event Registration Management (Admin only)
router.get(
  "/admin/events/:eventId/registrations",
  basicMiddleware,
  GetEventRegistrations
);
router.patch(
  "/admin/registrations/:registrationId/status",
  basicMiddleware,
  UpdateRegistrationStatus
);
router.post(
  "/admin/registrations/:registrationId/checkin",
  basicMiddleware,
  CheckInAttendee
);

module.exports = router;
