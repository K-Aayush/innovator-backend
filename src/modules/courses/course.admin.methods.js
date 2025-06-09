const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const Courses = require("./courses.model");
const path = require("path");
const fs = require("fs");

const AddCourse = async (req, res) => {
  try {
    const data = req?.body;
    const author = req?.admin;

    data.author = {
      email: author?.email,
      phone: author?.phone,
      _id: author?._id,
    };

    const newCourse = new Courses(data);
    await newCourse.save();

    const response = GenRes(
      200,
      newCourse.toObject(),
      null,
      "Added Successfully!"
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, { error }, error?.message);
    return res.status(500).json(response);
  }
};

const DelCourses = async (req, res) => {
  try {
    const _id = req?.params?.id;
    if (!_id || !isValidObjectId(_id)) {
      const response = GenRes(
        400,
        null,
        { error: "Invalid ID , Must be object ID" },
        "Invalid or Incorrect _id"
      );
      return res.status(400).json(response);
    }

    await Courses.findOneAndDelete({ _id });
    const response = GenRes(200, null, null, "Deleted Successfully!");

    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, { error }, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = { AddCourse, DelCourses };
