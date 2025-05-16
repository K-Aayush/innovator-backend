const aedes = require("aedes")();
const jwt = require("jsonwebtoken");
const Follow = require("../../modules/follow/follow.model");
const ChatMessage = require("../../modules/chat/chat.model");
const Notification = require("../../modules/notifications/notification.model");
const User = require("../../modules/user/user.model");

// Store online clients and their subscriptions
const onlineClients = new Map();
const activeChats = new Map();

// Authenticate mqtt clients using jwt
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

// Generate unique chat topic for two users
const getChatTopic = (user1Id, user2Id) => {
  const ids = [user1Id, user2Id].sort();
  return `chat/${ids[0]}/${ids[1]}`;
};

// Handle client connections
aedes.on("client", async (client) => {
  if (!client.user?._id) return;

  const userId = client.user._id;
  onlineClients.set(userId, client.id);

  // Subscribe to personal topics
  const personalTopics = [
    `user/${userId}/status`,
    `user/${userId}/messages`,
    `user/${userId}/notifications`,
    `user/${userId}/presence`,
  ];

  personalTopics.forEach((topic) => {
    client.subscribe(
      {
        topic,
        qos: 0,
      },
      (err) => {
        if (err) {
          console.error(`Error subscribing to ${topic}:`, err);
        } else {
          console.log(`Subscribed to ${topic}`);
        }
      }
    );
  });

  // Publish online status
  aedes.publish({
    topic: `user/${userId}/presence`,
    payload: JSON.stringify({
      userId: userId,
      status: "online",
      timestamp: new Date(),
    }),
  });

  console.log(`Client ${userId} connected and subscribed to personal topics`);
});

// Handle client disconnections
aedes.on("clientDisconnect", async (client) => {
  if (!client.user?._id) return;

  const userId = client.user._id;

  // Get all active chat topics for this user
  const userChatTopics = [];
  activeChats.forEach((users, topic) => {
    if (users.includes(userId)) {
      userChatTopics.push(topic);
    }
  });

  // Unsubscribe from all topics
  [
    ...userChatTopics,
    `user/${userId}/presence`,
    `user/${userId}/status`,
    `user/${userId}/messages`,
    `user/${userId}/notifications`,
  ].forEach((topic) => {
    client.unsubscribe(topic, (err) => {
      if (err) {
        console.error(`Error unsubscribing from ${topic}:`, err);
      } else {
        console.log(`Unsubscribed from ${topic}`);
      }
    });
  });

  // Clean up maps
  onlineClients.delete(userId);
  userChatTopics.forEach((topic) => activeChats.delete(topic));

  // Publish offline status
  aedes.publish({
    topic: `user/${userId}/presence`,
    payload: JSON.stringify({
      userId: userId,
      status: "offline",
      timestamp: new Date(),
    }),
  });

  console.log(`Client ${userId} disconnected and unsubscribed from all topics`);
});

// Handle published messages
aedes.on("publish", async (packet, client) => {
  if (!client || !client.user) return;

  const userId = client.user._id;

  // Handle chat initiation
  if (packet.topic.startsWith("chat/init/")) {
    try {
      const receiverId = packet.topic.split("/")[2];
      const message = JSON.parse(packet.payload.toString());

      // Verify mutual followers
      const [followA, followB] = await Promise.all([
        Follow.findOne({
          "follower._id": userId,
          "following._id": receiverId,
        }),
        Follow.findOne({
          "follower._id": receiverId,
          "following._id": userId,
        }),
      ]);

      if (!followA || !followB) {
        console.log("Users are not mutual followers");
        return;
      }

      // Create chat topic and subscribe both users
      const chatTopic = getChatTopic(userId, receiverId);
      activeChats.set(chatTopic, [userId, receiverId]);

      // Subscribe initiator
      client.subscribe(
        {
          topic: chatTopic,
          qos: 0,
        },
        (err) => {
          if (err) {
            console.error("Error subscribing initiator:", err);
          } else {
            console.log(`Initiator subscribed to ${chatTopic}`);
          }
        }
      );

      // Subscribe receiver if online
      const receiverClientId = onlineClients.get(receiverId);
      if (receiverClientId) {
        const receiverClient = aedes.clients[receiverClientId];
        if (receiverClient) {
          receiverClient.subscribe(
            {
              topic: chatTopic,
              qos: 0,
            },
            (err) => {
              if (err) {
                console.error("Error subscribing receiver:", err);
              } else {
                console.log(`Receiver subscribed to ${chatTopic}`);
              }
            }
          );
        }
      }

      console.log(
        `Chat initiated between ${userId} and ${receiverId} on topic ${chatTopic}`
      );
    } catch (error) {
      console.error("Error in chat initiation:", error);
    }
  }

  // Handle chat messages
  if (
    packet.topic.startsWith("chat/") &&
    !packet.topic.startsWith("chat/init/")
  ) {
    try {
      const messageData = JSON.parse(packet.payload.toString());
      console.log("Received message data:", messageData);

      // Create chat message
      const chatMessage = new ChatMessage({
        sender: {
          _id: messageData.senderId,
          email: messageData.senderEmail,
          name: messageData.senderName,
          picture: messageData.senderPicture || "",
        },
        receiver: {
          _id: messageData.receiverId,
          email: messageData.receiverEmail,
          name: messageData.receiverName,
          picture: messageData.receiverPicture || "",
        },
        message: messageData.content,
        read: false,
      });

      // Save message to database
      await chatMessage.save();
      console.log("Message saved successfully:", chatMessage._id);

      // Create notification
      const notification = new Notification({
        recipient: {
          _id: messageData.receiverId,
          email: messageData.receiverEmail,
        },
        sender: {
          _id: messageData.senderId,
          email: messageData.senderEmail,
          name: messageData.senderName,
          picture: messageData.senderPicture || "",
        },
        type: "message",
        content: `New message from ${messageData.senderName}`,
        metadata: {
          messageId: chatMessage._id.toString(),
          chatTopic: packet.topic,
        },
      });

      await notification.save();

      // Publish notification
      aedes.publish({
        topic: `user/${messageData.receiverId}/notifications`,
        payload: JSON.stringify(notification),
      });

      console.log(
        `Message saved and notification sent for topic ${packet.topic}`
      );
    } catch (error) {
      console.error("Error processing chat message:", error);
    }
  }
});

// Handle subscriptions
aedes.on("subscribe", (subscriptions, client) => {
  if (!client || !client.user) return;

  console.log(
    `Client ${client.user._id} subscribed to:`,
    subscriptions.map((s) => s.topic)
  );
});

// Handle unsubscriptions
aedes.on("unsubscribe", (subscriptions, client) => {
  if (!client || !client.user) return;

  console.log(`Client ${client.user._id} unsubscribed from:`, subscriptions);
});

module.exports = aedes;
