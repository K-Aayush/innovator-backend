const aedes = require("aedes")();
const jwt = require("jsonwebtoken");
const fs = require("fs").promises;
const path = require("path");
const Follow = require("../../modules/follow/follow.model");
const ChatMessage = require("../../modules/chat/chat.model");
const Notification = require("../../modules/notifications/notification.model");
const User = require("../../modules/user/user.model");

// Store online clients and their active chats
const onlineClients = new Map();
const userChats = new Map();

// Ensure chat directory exists and return file path
async function ensureChatDirectory(userEmail, chatId) {
  const baseDir = path.join(process.cwd(), "uploads", "chat", userEmail);

  try {
    await fs.mkdir(path.join(process.cwd(), "uploads"), { recursive: true });
    await fs.mkdir(path.join(process.cwd(), "uploads", "chat"), {
      recursive: true,
    });
    await fs.mkdir(baseDir, { recursive: true });

    return path.join(baseDir, `${chatId}.json`);
  } catch (error) {
    console.error("Error creating chat directory:", error);
    throw error;
  }
}

// Generate chat ID from user IDs
function generateChatId(...userIds) {
  return userIds.sort().join("_");
}

// Save chat message and relationship data to file
async function saveChatData(
  senderEmail,
  receiverEmail,
  senderId,
  receiverId,
  message
) {
  try {
    const chatId = generateChatId(senderId, receiverId);

    // Get file paths for both users
    const senderFile = await ensureChatDirectory(senderEmail, chatId);
    const receiverFile = await ensureChatDirectory(receiverEmail, chatId);

    // Fetch relationship data
    const [followData, followerData] = await Promise.all([
      Follow.findOne({
        "follower._id": senderId,
        "following._id": receiverId,
      }).lean(),
      Follow.findOne({
        "follower._id": receiverId,
        "following._id": senderId,
      }).lean(),
    ]);

    const chatData = {
      messages: [],
      relationship: {
        following: followData || null,
        follower: followerData || null,
        lastUpdated: new Date(),
      },
    };

    // Encrypt message before saving
    const encryptedMessage = ChatMessage.encryptMessage(message);

    const messageData = {
      timestamp: new Date(),
      sender: senderEmail,
      receiver: receiverEmail,
      message: encryptedMessage,
    };

    // Update both files
    for (const file of [senderFile, receiverFile]) {
      let existingData = chatData;
      try {
        const existing = await fs.readFile(file, "utf8");
        existingData = JSON.parse(existing);
      } catch (error) {
        console.log("Creating new chat file");
      }

      existingData.messages.push(messageData);
      existingData.relationship = {
        following: followData || existingData.relationship?.following || null,
        follower: followerData || existingData.relationship?.follower || null,
        lastUpdated: new Date(),
      };

      await fs.writeFile(file, JSON.stringify(existingData, null, 2));
    }

    return messageData;
  } catch (error) {
    console.error("Error saving chat data:", error);
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

  // Initialize user's chat set if not exists
  if (!userChats.has(userId)) {
    userChats.set(userId, new Set());
  }

  // Subscribe to personal topics
  const personalTopics = [
    `user/${userId}/status`,
    `user/${userId}/messages`,
    `user/${userId}/notifications`,
    `user/${userId}/presence`,
  ];

  // Resubscribe to all active chats
  const activeChats = userChats.get(userId);
  if (activeChats) {
    personalTopics.push(...activeChats);
  }

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

  // Get user's active chat topics
  const userTopics = userChats.get(userId) || new Set();

  // Unsubscribe from all topics
  const topics = [
    ...Array.from(userTopics),
    `user/${userId}/presence`,
    `user/${userId}/status`,
    `user/${userId}/messages`,
    `user/${userId}/notifications`,
  ];

  topics.forEach((topic) => {
    client.unsubscribe(topic);
  });

  // Remove client from online clients but keep their chat topics
  onlineClients.delete(userId);

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

      // Create chat topic and add to both users' chat sets
      const chatTopic = getChatTopic(userId, receiverId);

      // Add chat topic to both users' sets
      if (!userChats.has(userId)) userChats.set(userId, new Set());
      if (!userChats.has(receiverId)) userChats.set(receiverId, new Set());

      userChats.get(userId).add(chatTopic);
      userChats.get(receiverId).add(chatTopic);

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

      // Initialize chat data with relationship info
      const chatId = generateChatId(userId, receiverId);
      await saveChatData(
        message.sender.email,
        message.receiver.email,
        userId,
        receiverId,
        "Chat initiated"
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

      // Validate required fields
      if (
        !messageData.sender?.email ||
        !messageData.sender?._id ||
        !messageData.receiver?.email ||
        !messageData.receiver?._id ||
        !messageData.message
      ) {
        return;
      }

      // Save message and relationship data
      await saveChatData(
        messageData.sender.email,
        messageData.receiver.email,
        messageData.sender._id,
        messageData.receiver._id,
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

      // Publish notification
      aedes.publish({
        topic: `user/${messageData.receiver._id}/notifications`,
        payload: JSON.stringify(notification),
      });

      // Send real-time message update to both users
      const messageUpdate = {
        type: "new_message",
        message: {
          ...chatMessage.toObject(),
          message: messageData.message, // Send original message to clients
        },
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
