const GenRes = require("../../utils/routers/GenRes");
const User = require("../user/user.model");
const Follow = require("./follow.model");
const { isValidObjectId } = require("mongoose");
const ChatMessage = require("../chat/chat.model");

const UpdateFollow = async (req, res) => {
  try {
    const useremail = req?.user?.email;
    const followemail = req?.body?.email;

    if (!useremail || !followemail) {
      const response = GenRes(
        400,
        null,
        { error: "required details not found!" },
        "Required Details Not Found!"
      );
      return res.status(400).json(response);
    }

    const follower = await User.findOne({ email: useremail }).select(
      "_id email name picture"
    );

    if (!follower) {
      const response = GenRes(
        404,
        null,
        { error: "Follower not found!" },
        "Follower not found"
      );
      return res.status(404).json(response);
    }

    const following = await User.findOne({ email: followemail }).select(
      "_id email name picture"
    );
    if (!following) {
      const response = GenRes(
        404,
        null,
        { error: "Following not found!" },
        "Following not found"
      );
      return res.status(404).json(response);
    }

    const exists = await Follow.findOneAndDelete({
      "follower.email": useremail,
      "following.email": followemail,
    });

    if (!exists) {
      const newFollow = new Follow({
        follower: follower?.toObject(),
        following: following?.toObject(),
      });
      await newFollow.save();

      // Check if mutual follow exists
      const mutualFollow = await Follow.findOne({
        "follower.email": followemail,
        "following.email": useremail,
      });

      if (mutualFollow) {
        // Create welcome message from system
        const welcomeMessage = new ChatMessage({
          sender: follower.toObject(),
          receiver: following.toObject(),
          message: "👋 Hey! You can now chat with each other!",
          read: false,
        });
        await welcomeMessage.save();

        // Notify both users through Socket.IO
        const io = req.app.get("io");
        if (io) {
          io.to(follower._id.toString()).emit("refresh_chat_list");
          io.to(following._id.toString()).emit("refresh_chat_list");

          // Send new chat notification to both users
          io.to(follower._id.toString()).emit("new_chat", {
            user: following,
            message: welcomeMessage,
          });
          io.to(following._id.toString()).emit("new_chat", {
            user: follower,
            message: welcomeMessage,
          });
        }
      }
    }

    const response = GenRes(
      200,
      { follower, following },
      null,
      exists ? "Unfollowed Successfully!" : "Followed Successfully!"
    );

    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, { error: error }, error?.message);
    return res.status(500).json(response);
  }
};

// list followers
const ListFollowers = async (req, res) => {
  try {
    const page = parseInt(req?.query?.page || "0") || 0;
    const email = req?.user?.email;
    const follower = await Follow.find({ "following.email": email })
      .skip(page * 50)
      .limit(50)
      .select("follower");
    const response = GenRes(
      200,
      follower,
      `Responding ${follower?.length} followers!`
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error?.message, { error });
    return res.status(500).json(response);
  }
};

// list following
const ListFollowings = async (req, res) => {
  try {
    const page = parseInt(req?.query?.page || "0") || 0;
    const email = req?.user?.email;
    const following = await Follow.find({ "follower.email": email })
      .skip(page * 50)
      .limit(50)
      .select("following");
    const response = GenRes(
      200,
      following,
      `Responding ${following?.length} followings!`
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, error?.message, { error });
    return res.status(500).json(response);
  }
};

//Get user's followers
const GetUsersFollowers = async (req, res) => {
  try {
    const userId = req.params.id;
    const page = parseInt(req.query.page) || 0;
    const limit = 20;

    if (!isValidObjectId(userId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid user ID" },
            "Invalid user ID provided"
          )
        );
    }

    //find the existing user
    const user = await User.findById(userId);

    //check if user exists
    if (!user) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "User not found" }, "User not found"));
    }

    //find the followers
    const followers = await Follow.find({ "following._id": userId })
      .select("follower")
      .skip(page * limit)
      .limit(limit)
      .lean();

    //map the followerList
    const followerList = followers.map((f) => {
      const { _id, ...followerData } = f.follower;
      return followerData;
    });

    //If success return 200 OK
    return res
      .status(200)
      .json(
        GenRes(
          200,
          followerList,
          null,
          `Found ${followerList.length} followers`
        )
      );
  } catch (error) {
    //catch the error if any occurs
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

//Get user's following
const GetUsersFollowing = async (req, res) => {
  try {
    const userId = req.params.id;
    const page = parseInt(req.query.page) || 0;
    const limit = 20;

    if (!isValidObjectId(userId)) {
      return res
        .status(400)
        .json(
          GenRes(
            400,
            null,
            { error: "Invalid user ID" },
            "Invalid user ID provided"
          )
        );
    }

    //find the existing user
    const user = await User.findById(userId);

    //return 404 error if user doesn't exists
    if (!user) {
      return res
        .status(404)
        .json(GenRes(404, null, { error: "User not found" }, "User not found"));
    }

    //find the followings
    const following = await Follow.find({ "follower._id": userId })
      .select("following")
      .skip(page * limit)
      .limit(limit)
      .lean();

    //map the followingList
    const followingList = following.map((f) => {
      const { _id, ...followingData } = f.following;
      return followingData;
    });

    //If success return 200 OK
    return res
      .status(200)
      .json(
        GenRes(
          200,
          followingList,
          null,
          `Found ${followingList.length} followings`
        )
      );
  } catch (error) {
    //catch the error if any occurs
    return res.status(500).json(GenRes(500, null, error, error?.message));
  }
};

module.exports = {
  UpdateFollow,
  ListFollowers,
  ListFollowings,
  GetUsersFollowers,
  GetUsersFollowing,
};
