const User = require("./user.model");
const { setCode, verifyCode } = require("../../utils/auth/changePass");
const bcrypt = require("bcryptjs");
const GenRes = require("../../utils/routers/GenRes");
const Follow = require("../follow/follow.model");
const { isValidObjectId } = require("mongoose");
const FCMHandler = require("../../utils/notifications/fcmHandler");

// check if user exists
const UserExist = async (req, res) => {
  try {
    const data = await User.findOne({
      email: req?.query?.email?.toLowerCase(),
    });
    if (data) {
      const response = GenRes(200, data, null, "Exists");
      return res.status(200).json(response);
    }
    const response = GenRes(
      404,
      null,
      { error: "User Not Found" },
      "Doesnot Exist"
    );
    return res.status(404).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return response;
  }
};

// get all users
const GetAllUsers = async (req, res) => {
  try {
    const data = await User.find()
      .select("-password -refreshToken -role -signedIn -createdAt")
      .lean();

    if (!data || data.length === 0) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "No users found!" }, "Not found"));
    }

    // Add follower and following counts for each user
    const users = await Promise.all(
      data.map(async (user) => {
        const followers = await Follow.countDocuments({
          "following._id": user._id,
        });
        const following = await Follow.countDocuments({
          "follower._id": user._id,
        });
        return {
          ...user,
          followers,
          following,
        };
      })
    );

    return res
      .status(200)
      .json(GenRes(200, users, null, "All Users Retrieved"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// get profile
const UserProfile = async (req, res) => {
  try {
    const { uid, _id } = req?.user;

    const userQuery = uid ? { uid } : { _id };

    const data = await User.findOne(userQuery).lean();

    if (!data) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "User not found!" }, "Not found"));
    }

    delete data.refreshToken;
    delete data.signedIn;

    const followers = await Follow.countDocuments({
      "following._id": data?._id,
    });

    const following = await Follow.countDocuments({
      "follower._id": data?._id,
    });

    data.followers = followers;
    data.following = following;

    return res.status(200).json(GenRes(200, data, null, "Send User"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

// verify
const NewOtp = async (req, res) => {
  const email = req?.body?.email?.toLowerCase();
  const response = await setCode(email);
  return res.status(response?.status).json(response);
};

// set password
const SetPassword = async (req, res) => {
  try {
    const { email, password, otp } = req?.body;

    const verifyRes = await verifyCode(email, otp);
    if (verifyRes?.status !== 200) {
      return res.status(verifyRes?.status).json(verifyRes);
    }

    const salt = await bcrypt.genSalt(10);
    const updatedResponse = await User.findOneAndUpdate(
      { email },
      {
        $set: {
          password: await bcrypt.hash(password, salt),
        },
      }
    );
    if (!updatedResponse) {
      throw new Error("Update Failed!");
    }
    return res
      .status(200)
      .json(GenRes(200, null, null, "Updated Successfully "));
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

// add new data
const SetAvatar = async (req, res) => {
  try {
    const { email } = req?.user;

    if (!req?.file_location) {
      throw new Error("No image uploaded.");
    }

    const uploaded = await User.findOneAndUpdate(
      { email },
      { picture: req?.file_location }, // FIX: use direct update, not $or
      { new: true } // optional: return updated user
    );

    if (!uploaded) {
      throw new Error("Failed to upload Picture.");
    }

    return res
      .status(200)
      .json(
        GenRes(
          200,
          { picture: req?.file_location },
          null,
          "Uploaded Successfully!"
        )
      );
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

const SetDetails = async (req, res) => {
  try {
    const data = req?.body;
    const email = req?.user?.email;
    if (!email) {
      const response = GenRes(
        400,
        null,
        { error: "Required data not found!" },
        "400 | Bad request"
      );
      return res.status(400).json(response);
    }

    const deletes = "email,_id,uid,password,avatar,refreshToken".split(",");

    for (const keys of deletes) {
      delete data?.[keys];
    }

    const updated = await User.findOneAndUpdate(
      { email },
      { $set: { ...data } }
    );

    if (!updated) {
      throw new Error("500 | Could not save");
    }

    const response = GenRes(200, data, null, "Updated Successfully!");
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error, error?.message);
    return res.status(500).json(response);
  }
};

const StalkProfile = async (req, res) => {
  try {
    const _id = req?.params?.id;
    if (!_id || !isValidObjectId(_id)) {
      const response = GenRes(
        400,
        null,
        { error: "user_id must be provided" },
        "User id not provided"
      );
      return res.status(400).json(response);
    }

    const profile = await User.findOne({ _id })
      .select("-uid -password -refreshToken -role -signedIn -createdAt")
      .lean();
    if (!profile) {
      const response = GenRes(
        404,
        null,
        { error: "User not found" },
        "User not found!"
      );
      return res.status(404).json(response);
    }

    const following = await Follow.findOne({
      "follower.email": req?.user?.email,
      "following.email": profile?.email,
    });

    const follower = await Follow.findOne({
      "follower.email": profile.email,
      "following.email": req?.user?.email,
    });

    const followers = await Follow.countDocuments({
      "following.email": profile?.email,
    });
    const followings = await Follow.countDocuments({
      "follower.email": profile?.email,
    });

    profile.followed = !!following;
    profile.friends = !!follower && !!following;
    profile.followers = followers;
    profile.followings = followings;

    const response = GenRes(200, profile, null, "Responding User Profile");
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, { error }, error?.message);
    return res.status(500).json(response);
  }
};

const UpdateFCMToken = async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user._id;

    if (!token) {
      return res
        .status(400)
        .json(
          GenRes(400, null, { error: "Token is required" }, "Token is required")
        );
    }

    await User.updateOne({ _id: userId }, { $addToSet: { fcmTokens: token } });

    return res
      .status(200)
      .json(GenRes(200, null, null, "FCM token updated successfully"));
  } catch (error) {
    return res.status(500).json(GenRes(500, null, error, error.message));
  }
};

module.exports = {
  UserExist,
  GetAllUsers,
  UserProfile,
  NewOtp,
  SetPassword,
  SetAvatar,
  SetDetails,
  StalkProfile,
  UpdateFCMToken,
};
