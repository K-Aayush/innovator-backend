const basicMiddleware = require("../../middlewares/basicMiddleware");
const AdminFiles = require("../../utils/fileProcessor/multer.courses");
const { AddCourse, DelCourses } = require("./course.admin.methods");
const { MultipleFiles, DeleteFiles } = require("./course.file");
const ListCourses = require("./courses.list");
// const { GetCourse } = require("./courses.methods");

const route = require("express").Router();

// add files
route.post(
  "/add-public-course-file",
  basicMiddleware,
  AdminFiles("public").any(),
  MultipleFiles
);
route.post(
  "/add-private-course-file",
  basicMiddleware,
  AdminFiles("private").any(),
  MultipleFiles
);

route.delete("/delete-course-files", basicMiddleware, DeleteFiles);

route.post("/add-course", basicMiddleware, AddCourse);

// delete courses
route.delete("/delete-courses/:id", basicMiddleware, DelCourses);

// list courses
route.get("/list-courses", basicMiddleware, ListCourses);
// admin list courses
route.get("/admin-list-courses/:page", basicMiddleware, ListCourses);

// admin individual
// route.get("/get-course/:id", basicMiddleware, GetCourse);
// route.get("/admin-get-course/:id", basicMiddleware, GetCourse);

module.exports = route;
