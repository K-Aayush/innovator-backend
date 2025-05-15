const aedes = require("aedes")();
const jwt = require("jsonwebtoken");
const CryptoJS = require("crypto-js");
const Follow = require("../../modules/follow/follow.model");
const ChatMessage = require("../../modules/chat/chat.model");
const Notification = require("../../modules/notifications/notification.model");

//store online clients
const onlineClients = new Map();

//Authenticate mqtt clients using jwt
aedes.authenticate = async (client, username, password, callback) => {
  try {
    const token = password.toString();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    client.user = decoded;
    callback(null, true);
  } catch (error) {
    callback(error, false);
  }
};

//Handle client connections
aedes.on("client", async (client) => {
  onlineClients.set(client.user._id, client.id);

  //publish online status
  aedes.publish({
    topic: "user/status",
    payload: JSON.stringify({
      userId: client.user._id,
      status: "online",
      timestamp: new Date(),
    }),
  });
});

//Handle client disconnections
aedes.on("clientDisconnect", async (client) => {
  onlineClients.delete(client.user._id);

  aedes.publish({
    topic: "user/status",
    payload: JSON.stringify({
      userId: client.user._id,
      status: "offline",
      timestamp: new Date(),
    }),
  });
});

//Handle published messages
aedes.on("publish", async (packet, client) => {
  if (!client) return;

  if (packet.topic.startsWith("chat/")) {
    try {
      const [, receiverId] = packet.topic.split("/");
      const message = JSON.parse(packet.payload.toString());

      //verify mutual followers
      const [followA, followB] = await Promise.all([
        Follow.findOne({
          "follower._id": client.user._id,
          "following._id": receiverId,
        }),
        Follow.findOne({
          "follower._id": receiverId,
          "following._id": client.user._id,
        }),
      ]);

      if (!followA || !followB) {
        return;
      }

      //save encrypted message
      const chatMessage = new ChatMessage({
        sender: {
          _id: client.user._id,
          email: client.user.email,
          name: message.senderName,
          picture: message.senderPicture,
        },
        receiver: {
          _id: receiverId,
          email: message.receiverEmail,
          name: message.receiverName,
          picture: message.receiverPicture,
        },
        message: message.content,
        read: false,
      });

      await chatMessage.save();

      //Create Notification
      const notification = new Notification({
        recipient: {
          _id: receiverId,
          email: message.receiverEmail,
        },
        sender: {
          _id: client.user._id,
          email: client.user.email,
          name: message.senderName,
          picture: message.senderPicture,
        },
        type: "message",
        content: `New message from ${message.senderName}`,
        metadata: {
          messageId: chatMessage._id.toString(),
          type: "chat",
        },
      });

      await notification.save();

      //forward message to receiver if online
      const receiverClientId = onlineClients.get(receiverId);
      if (receiverClientId) {
        aedes.publish({
          topic: `user/${receiverId}/messages`,
          payload: JSON.stringify({
            ...chatMessage.toObject(),
            message: chatMessage.decryptMessage(),
          }),
        });
      }

      //send notification
      aedes.publish({
        topic: `user/${receiverId}/notifications`,
        payload: JSON.stringify(notification),
      });
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }
});

module.exports = aedes;
