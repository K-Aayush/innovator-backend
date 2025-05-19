const GenRes = require("../../utils/routers/GenRes");
const User = require("../user/user.model");
const Follow = require("./follow.model");
const { isValidObjectId } = require("mongoose");
const ChatMessage = require("../chat/chat.model");

// Generate unique chat topic for two users
const getChatTopic = (user1Id, user2Id) => {
  const ids = [user1Id, user2Id].sort();
  return `chat/${ids[0]}/${ids[1]}`;
};

const UpdateFollow = async (req, res) => {
  try {
    const useremail = req?.user?.email;
    const followemail = req?.body?.email;
    const action = req?.body?.action;

    if (!useremail || !followemail) {
      const response = GenRes(
        400,
        null,
        { error: "Required details not found!" },
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

    const followExists = await Follow.findOne({
      "follower.email": useremail,
      "following.email": followemail,
    });

    const aedes = req.app.get("aedes");

    if (action === "unfollow") {
      if (!followExists) {
        const response = GenRes(
          400,
          null,
          { error: "Not following this user!" },
          "Not following this user"
        );
        return res.status(400).json(response);
      }
      await Follow.deleteOne({
        "follower.email": useremail,
        "following.email": followemail,
      });

      // Notify both users of follow status update
      if (aedes) {
        const mutualFollow = await Follow.findOne({
          "follower.email": followemail,
          "following.email": useremail,
        });

        aedes.publish({
          topic: `user/${follower._id}/follow_status`,
          payload: JSON.stringify({
            type: "follow_status_update",
            userId: following._id.toString(),
            userEmail: following.email,
            userName: following.name,
            isFollowing: false,
            isFollowedBy: !!mutualFollow,
          }),
          qos: 0,
        });

        aedes.publish({
          topic: `user/${following._id}/follow_status`,
          payload: JSON.stringify({
            type: "follow_status_update",
            userId: follower._id.toString(),
            userEmail: follower.email,
            userName: follower.name,
            isFollowing: !!mutualFollow,
            isFollowedBy: false,
          }),
          qos: 0,
        });
      }

      const response = GenRes(
        200,
        { follower, following },
        null,
        "Unfollowed Successfully!"
      );
      return res.status(200).json(response);
    } else {
      if (followExists) {
        const response = GenRes(
          400,
          null,
          { error: "Already following this user!" },
          "Already following this user"
        );
        return res.status(400).json(response);
      }
      const newFollow = new Follow({
        follower: follower?.toObject(),
        following: following?.toObject(),
      });
      await newFollow.save();

      // Notify both users of follow status update
      if (aedes) {
        const mutualFollow = await Follow.findOne({
          "follower.email": followemail,
          "following.email": useremail,
        });

        aedes.publish({
          topic: `user/${follower._id}/follow_status`,
          payload: JSON.stringify({
            type: "follow_status_update",
            userId: following._id.toString(),
            userEmail: following.email,
            userName: following.name,
            isFollowing: true,
            isFollowedBy: !!mutualFollow,
          }),
          qos: 0,
        });

        aedes.publish({
          topic: `user/${following._id}/follow_status`,
          payload: JSON.stringify({
            type: "follow_status_update",
            userId: follower._id.toString(),
            userEmail: follower.email,
            userName: follower.name,
            isFollowing: !!mutualFollow,
            isFollowedBy: true,
          }),
          qos: 0,
        });
      }

      // Check for mutual follow and handle chat
      const mutualFollow = await Follow.findOne({
        "follower.email": followemail,
        "following.email": useremail,
      });

      if (mutualFollow) {
        const welcomeMessage = new ChatMessage({
          sender: follower.toObject(),
          receiver: following.toObject(),
          message: "👋 Hey! You can now chat with each other!",
          read: false,
        });
        await welcomeMessage.save();

        if (aedes) {
          const chatTopic = getChatTopic(
            follower._id.toString(),
            following._id.toString()
          );

          // Send new chat notification to both users with full chat data
          const newChatPayloadFollower = {
            type: "new_chat",
            chat: {
              user: {
                _id: following._id,
                email: following.email,
                name: following.name,
                picture: following.picture || "",
              },
              lastMessage: {
                ...welcomeMessage.toObject(),
                message: welcomeMessage.decryptMessage(),
              },
              unreadCount: 0,
            },
          };
          const newChatPayloadFollowing = {
            type: "new_chat",
            chat: {
              user: {
                _id: follower._id,
                email: follower.email,
                name: follower.name,
                picture: follower.picture || "",
              },
              lastMessage: {
                ...welcomeMessage.toObject(),
                message: welcomeMessage.decryptMessage(),
              },
              unreadCount: 1,
            },
          };

          aedes.publish({
            topic: `user/${follower._id}/messages`,
            payload: JSON.stringify(newChatPayloadFollower),
            qos: 0,
          });
          aedes.publish({
            topic: `user/${following._id}/messages`,
            payload: JSON.stringify(newChatPayloadFollowing),
            qos: 0,
          });

          // Subscribe both users to the chat topic if online
          const onlineClients = aedes.onlineClients || new Map();
          if (onlineClients.has(follower._id.toString())) {
            const followerClient =
              aedes.clients[onlineClients.get(follower._id.toString())];
            if (followerClient) {
              followerClient.subscribe({ topic: chatTopic, qos: 0 });
            }
          }
          if (onlineClients.has(following._id.toString())) {
            const followingClient =
              aedes.clients[onlineClients.get(following._id.toString())];
            if (followingClient) {
              followingClient.subscribe({ topic: chatTopic, qos: 0 });
            }
          }

          // Update userChats for both users
          if (!aedes.userChats.has(follower._id.toString())) {
            aedes.userChats.set(follower._id.toString(), new Set());
          }
          if (!aedes.userChats.has(following._id.toString())) {
            aedes.userChats.set(following._id.toString(), new Set());
          }
          aedes.userChats.get(follower._id.toString()).add(chatTopic);
          aedes.userChats.get(following._id.toString()).add(chatTopic);
        }
      }

      const response = GenRes(
        200,
        { follower, following },
        null,
        "Followed Successfully!"
      );
      return res.status(200).json(response);
    }
  } catch (error) {
    const response = GenRes(500, null, { error: error.message }, error.message);
    return res.status(500).json(response);
  }
};

// Check follow status between two users
const CheckFollowStatus = async (req, res) => {
  try {
    const useremail = req?.user?.email;
    const targetemail = req?.query?.email;

    if (!useremail || !targetemail) {
      const response = GenRes(
        400,
        null,
        { error: "Required details not found!" },
        "Required Details Not Found!"
      );
      return res.status(400).json(response);
    }

    const user = await User.findOne({ email: useremail }).select(
      "_id email name picture"
    );
    if (!user) {
      const response = GenRes(
        404,
        null,
        { error: "User not found!" },
        "User not found"
      );
      return res.status(404).json(response);
    }

    const targetUser = await User.findOne({ email: targetemail }).select(
      "_id email name picture"
    );
    if (!targetUser) {
      const response = GenRes(
        404,
        null,
        { error: "Target user not found!" },
        "Target user not found"
      );
      return res.status(404).json(response);
    }

    // Check follow relationships
    const [isFollowing, isFollowedBy] = await Promise.all([
      Follow.findOne({
        "follower.email": useremail,
        "following.email": targetemail,
      }),
      Follow.findOne({
        "follower.email": targetemail,
        "following.email": useremail,
      }),
    ]);

    const response = GenRes(
      200,
      {
        user: {
          _id: targetUser._id,
          email: targetUser.email,
          name: targetUser.name,
          picture: targetUser.picture,
        },
        isFollowing: !!isFollowing,
        isFollowedBy: !!isFollowedBy,
      },
      null,
      "Follow status retrieved successfully"
    );
    return res.status(200).json(response);
  } catch (error) {
    const response = GenRes(500, null, { error: error.message }, error.message);
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
  CheckFollowStatus,
  ListFollowers,
  ListFollowings,
  GetUsersFollowers,
  GetUsersFollowing,
};
