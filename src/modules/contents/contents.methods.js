const path = require("path");
const GenRes = require("../../utils/routers/GenRes");
const User = require("../user/user.model");
const Content = require("./contents.model");
const Notification = require("../notifications/notification.model");
const fs = require("fs");
const { CleanUpAfterDeleteContent } = require("./contents.cleanup");
const transporter = require("../../config/Mailer");
const Follow = require("../follow/follow.model");

const AddContent = async (req, res) => {
  try {
    const data = req?.body;
    const user = req?.user;

    // author finder
    const author = await User.findOne({ ...user })
      .select("picture name email uid _id")
      .lean();

    //Not an author
    if (!author) {
      const response = GenRes(
        401,
        null,
        { error: "User Authentication Failed" },
        "User Not Found"
      );

      return res.status(401).json(response);
    }

    // If this is a share, verify and process the original content
    if (data.type === "share" && data.originalContentId) {
      const originalContent = await Content.findById(
        data.originalContentId
      ).lean();
      if (!originalContent) {
        return res
          .status(404)
          .json(
            GenRes(
              404,
              null,
              { error: "Original content not found" },
              "Content to share not found"
            )
          );
      }

      data.isShared = true;
      data.originalContent = {
        _id: originalContent._id,
        type: originalContent.type,
        files: originalContent.files,
        status: originalContent.status,
        author: originalContent.author,
        createdAt: originalContent.createdAt,
      };
    }

    // save data
    const newData = new Content({ ...data, author: author });
    await newData.save();

    // Create notification for followers
    const followers = await Follow.find({ "following.email": author.email });

    const notifications = followers.map((follower) => ({
      recipient: {
        _id: follower.follower._id,
        email: follower.follower.email,
      },
      sender: {
        _id: author._id,
        email: author.email,
        name: author.name,
        picture: author.picture,
      },
      type: "content",
      content: data.isShared
        ? `${author.name} shared a post`
        : `${author.name} shared a new post`,
      metadata: {
        itemId: newData._id.toString(),
        itemType: "content",
        isShared: data.isShared,
        originalContentId: data.originalContent?._id,
      },
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);

      // Emit notifications to online users
      const io = req.app.get("io");
      if (io) {
        notifications.forEach((notification) => {
          io.to(notification.recipient._id).emit(
            "new_notification",
            notification
          );
        });
      }
    }

    // If this is a share, notify the original content author
    if (data.isShared) {
      const shareNotification = new Notification({
        recipient: {
          _id: data.originalContent.author._id,
          email: data.originalContent.author.email,
        },
        sender: {
          _id: author._id,
          email: author.email,
          name: author.name,
          picture: author.picture,
        },
        type: "share",
        content: `${author.name} shared your post`,
        metadata: {
          itemId: newData._id.toString(),
          originalContentId: data.originalContent._id,
          itemType: "content",
        },
      });

      await shareNotification.save();

      if (io) {
        io.to(data.originalContent.author._id).emit(
          "new_notification",
          shareNotification
        );
      }
    }

    const response = GenRes(
      200,
      newData.toObject(),
      null,
      "Saved Successfully"
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const UpdateContents = async (req, res) => {
  try {
    const data = req?.body;
    const _id = req?.params?.id;
    const userEmail = req?.user?.email;

    console.log("Updating content with id:", _id);
    console.log("User email:", userEmail);
    console.log(data);

    delete data?._id;
    delete data?.author;

    const saved = await Content.findOneAndUpdate(
      { _id, "author.email": userEmail },
      { $set: { ...data } },
      { new: true } // Ensure it returns the updated document
    );

    console.log(saved);

    if (!saved) {
      throw new Error("Could not save or no document found!");
    }

    const response = GenRes(200, saved, null, "Data successfully updated!");
    return res.status(200).json(response);
  } catch (error) {
    console.error("Error updating content:", error);
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const DeleteContent = async (req, res) => {
  try {
    const _id = req?.params?.id;
    const deletedData = await Content.findOneAndDelete({
      _id,
      "author.email": req?.user?.email,
    });

    const images = Array.isArray(deletedData?.files)
      ? [...deletedData.files]
      : [];

    const failed = [];

    console.log(images);
    for (const image of images) {
      try {
        const fullpath = path.join(process.cwd(), image.slice(1));
        fs.unlinkSync(fullpath);
      } catch (err) {
        console.log(err?.message);
        failed.push(image);
      }
    }

    // run a cleanup functions
    CleanUpAfterDeleteContent(_id);

    if (req?.admin && req?.admin === "admin") {
      // Send email
      await transporter.sendMail({
        from: process.env.MAIL,
        to: email,
        subject: "Content Removed - Policy Violation on Innovator",
        html: `
          <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: auto; padding: 20px; border-radius: 10px; background-color: #fff7f0; border: 1px solid #ffcc80;">
            <h2 style="color: #ff6f00;">⚠️ Content Removal Notice</h2>
            <p style="font-size: 16px; color: #333;">Hi there,</p>
            <p style="font-size: 15px; color: #555;">
              We've removed certain content from your account because it violates our community guidelines on <strong>Innovator</strong>.
            </p>
            <div style="padding: 15px; background-color: #fff3e0; border-left: 5px solid #ff9800; margin: 20px 0;">
              <p style="margin: 0; color: #444;">${req?.body?.message}</p>
            </div>
            <p style="font-size: 15px; color: #555;">
              If you believe this was in error or need further assistance, please don't hesitate to contact our support team.
            </p>
            <p style="font-size: 15px; color: #333;">
              Thank you for helping us maintain a positive and respectful community.<br/>
              — <strong>The Innovator Team</strong>
            </p>
          </div>
        `,
      });
    }

    const response = GenRes(
      failed?.length > 0 ? 207 : 200,
      { failures: failed },
      null,
      "Deleted Data"
    );
    return res.status(response?.status).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

module.exports = { AddContent, UpdateContents, DeleteContent };
