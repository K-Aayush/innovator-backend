const aedes = require("aedes")();
const jwt = require("jsonwebtoken");
const fs = require("fs").promises;
const path = require("path");
const Follow = require("../../modules/follow/follow.model");
const ChatMessage = require("../../modules/chat/chat.model");
const Notification = require("../../modules/notifications/notification.model");
const User = require("../../modules/user/user.model");

// Store online clients and their subscriptions
const onlineClients = new Map();
const activeChats = new Map();

// Ensure chat directory exists for a user
async function ensureChatDirectory(userEmail) {
  const baseDir = path.join(process.cwd(), "uploads");
  const userDir = path.join(baseDir, userEmail, "chat");

  try {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(path.join(baseDir, userEmail), { recursive: true });
    await fs.mkdir(userDir, { recursive: true });
    return userDir;
  } catch (error) {
    console.error("Error creating chat directory:", error);
    throw error;
  }
}

// Save chat message to file
async function saveChatMessage(senderEmail, receiverEmail, message) {
  try {
    // Save for sender
    const senderDir = await ensureChatDirectory(senderEmail);
    const senderFile = path.join(senderDir, `${receiverEmail}.json`);

    // Save for receiver
    const receiverDir = await ensureChatDirectory(receiverEmail);
    const receiverFile = path.join(receiverDir, `${senderEmail}.json`);

    const messageData = {
      timestamp: new Date(),
      sender: senderEmail,
      receiver: receiverEmail,
      message: message,
    };

    // Update both files
    for (const file of [senderFile, receiverFile]) {
      let messages = [];
      try {
        const existing = await fs.readFile(file, "utf8");
        messages = JSON.parse(existing);
      } catch (error) {
        console.log(error);
      }

      messages.push(messageData);
      await fs.writeFile(file, JSON.stringify(messages, null, 2));
    }
  } catch (error) {
    console.error("Error saving chat message to file:", error);
    throw error;
  }
}

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
      () => console.log(`Subscribed to ${topic}`)
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
  const topics = [
    ...userChatTopics,
    `user/${userId}/presence`,
    `user/${userId}/status`,
    `user/${userId}/messages`,
    `user/${userId}/notifications`,
  ];

  topics.forEach((topic) => {
    client.unsubscribe(topic);
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

      // Validate required fields
      if (
        !message.sender?._id ||
        !message.sender?.email ||
        !message.receiver?._id ||
        !message.receiver?.email
      ) {
        return;
      }

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

      if (!followA || !followB) return;

      // Create chat topic and subscribe both users
      const chatTopic = getChatTopic(userId, receiverId);
      activeChats.set(chatTopic, [userId, receiverId]);

      // Subscribe initiator
      client.subscribe({ topic: chatTopic, qos: 0 });

      // Subscribe receiver if online
      const receiverClientId = onlineClients.get(receiverId);
      if (receiverClientId) {
        const receiverClient = aedes.clients[receiverClientId];
        if (receiverClient) {
          receiverClient.subscribe({ topic: chatTopic, qos: 0 });
        }
      }

      // Create chat directories for both users
      await Promise.all([
        ensureChatDirectory(message.sender.email),
        ensureChatDirectory(message.receiver.email),
      ]);
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

      // Validate required fields
      if (
        !messageData.sender?.email ||
        !messageData.receiver?.email ||
        !messageData.message
      ) {
        return;
      }

      // Save message to files
      await saveChatMessage(
        messageData.sender.email,
        messageData.receiver.email,
        messageData.message
      );

      // Create chat message in database
      const chatMessage = new ChatMessage({
        sender: {
          _id: messageData.sender._id,
          email: messageData.sender.email,
          name: messageData.sender.name,
          picture: messageData.sender.picture || "",
        },
        receiver: {
          _id: messageData.receiver._id,
          email: messageData.receiver.email,
          name: messageData.receiver.name,
          picture: messageData.receiver.picture || "",
        },
        message: messageData.message,
        read: false,
      });

      await chatMessage.save();

      // Create and send notification
      const notification = new Notification({
        recipient: {
          _id: messageData.receiver._id,
          email: messageData.receiver.email,
        },
        sender: {
          _id: messageData.sender._id,
          email: messageData.sender.email,
          name: messageData.sender.name,
          picture: messageData.sender.picture || "",
        },
        type: "message",
        content: `New message from ${messageData.sender.name}`,
        metadata: {
          messageId: chatMessage._id.toString(),
          chatTopic: packet.topic,
        },
      });

      await notification.save();

      // Publish notification and real-time message update
      aedes.publish({
        topic: `user/${messageData.receiver._id}/notifications`,
        payload: JSON.stringify(notification),
      });

      // Send real-time message update to both users
      const messageUpdate = {
        type: "new_message",
        message: chatMessage,
      };

      [messageData.sender._id, messageData.receiver._id].forEach((userId) => {
        aedes.publish({
          topic: `user/${userId}/messages`,
          payload: JSON.stringify(messageUpdate),
        });
      });
    } catch (error) {
      console.error("Error processing chat message:", error);
    }
  }
});

module.exports = aedes;
