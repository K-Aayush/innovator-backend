const { isValidObjectId } = require("mongoose");
const GenRes = require("../../utils/routers/GenRes");
const Courses = require("./courses.model");

const AddCourse = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can add courses"
          )
        );
    }

    const data = req?.body;

    data.author = {
      _id: req.user._id,
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
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json(
          GenRes(
            403,
            null,
            { error: "Not authorized" },
            "Only admins can delete courses"
          )
        );
    }

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
