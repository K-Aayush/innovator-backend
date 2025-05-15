const basicMiddleware = require("../../middlewares/basicMiddleware");
const UserFiles = require("../../utils/fileProcessor/multer.users.js");
const { MultipleFiles, SingleFile, DeleteFiles } = require("./contents.files");
const ListContents = require("./contents.list.js");
const {
  AddContent,
  UpdateContents,
  DeleteContent,
} = require("./contents.methods");

const router = require("express").Router();

// files
// add multiple files
router.post("/add-files", basicMiddleware, UserFiles.any(), MultipleFiles);

//single file | add or updateadd
router.post("/add-file", basicMiddleware, UserFiles.single("file"), SingleFile);

// delete files
router.post("/delete-files", basicMiddleware, DeleteFiles);

// post new data
router.post("/new-content", basicMiddleware, AddContent);

// update data
router.post("/update-contents/:id", basicMiddleware, UpdateContents);

// delete whole contents
router.delete("/delete-content/:id", basicMiddleware, DeleteContent);

// get data
router.get("/list-contents", basicMiddleware, ListContents);

// admin
router.get("/list-admin-contents/:page", basicMiddleware, ListContents);

// make delete
router.delete("/admin-delete-content/:id", basicMiddleware, DeleteContent);

module.exports = router;
