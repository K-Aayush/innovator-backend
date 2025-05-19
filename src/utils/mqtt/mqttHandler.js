const aedes = require("aedes")();
const jwt = require("jsonwebtoken");
const fs = require("fs").promises;
const path = require("path");
const Follow = require("../../modules/follow/follow.model");
const ChatMessage = require("../../modules/chat/chat.model");
const Notification = require("../../modules/notifications/notification.model");

// Store online clients and their active chats
const onlineClients = new Map();
const userChats = new Map();

// Create base chat directory during initialization
(async () => {
  try {
    await fs.mkdir(path.join(process.cwd(), "uploads", "chat"), {
      recursive: true,
    });
    console.log("Base chat directory structure created");
  } catch (error) {
    console.error("Error creating base chat directory:", error);
  }
})();

// Generate chat ID from user IDs
function generateChatId(...userIds) {
  return userIds.sort().join("_");
}

// Check if users are mutual followers
async function checkMutualFollow(user1Id, user2Id) {
  try {
    const [follow1, follow2] = await Promise.all([
      Follow.findOne({
        "follower._id": user1Id,
        "following._id": user2Id,
      }),
      Follow.findOne({
        "follower._id": user2Id,
        "following._id": user1Id,
      }),
    ]);
    return !!follow1 && !!follow2;
  } catch (error) {
    console.error("Error checking mutual follow:", error);
    return false;
  }
}

// Save chat message to file
async function saveChatData(senderId, receiverId, message) {
  try {
    const chatId = generateChatId(senderId, receiverId);
    const chatDir = path.join(process.cwd(), "uploads", "chat");
    const chatFile = path.join(chatDir, `${chatId}.json`);

    let chatData = {
      messages: [],
      lastUpdated: new Date(),
    };

    try {
      const existing = await fs.readFile(chatFile, "utf8");
      chatData = JSON.parse(existing);
    } catch (error) {
      console.log("Creating new chat file");
    }

    chatData.messages.push({
      senderId,
      message: ChatMessage.encryptMessage(message),
      timestamp: new Date(),
    });

    await fs.writeFile(chatFile, JSON.stringify(chatData, null, 2));
    return chatData;
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
    `user/${userId}/messages`,
    `user/${userId}/notifications`,
    `user/${userId}/presence`,
  ];

  // Resubscribe to all active chats
  const activeChats = userChats.get(userId);
  if (activeChats) {
    personalTopics.push(...activeChats);
  }

  for (const topic of personalTopics) {
    client.subscribe({ topic, qos: 0 }, () => {});
  }

  // Publish online status
  aedes.publish({
    topic: `user/${userId}/presence`,
    payload: JSON.stringify({
      userId,
      status: "online",
      timestamp: new Date(),
    }),
  });
});

// Handle client disconnections
aedes.on("clientDisconnect", (client) => {
  if (!client.user?._id) return;

  const userId = client.user._id;
  onlineClients.delete(userId);

  // Publish offline status
  aedes.publish({
    topic: `user/${userId}/presence`,
    payload: JSON.stringify({
      userId,
      status: "offline",
      timestamp: new Date(),
    }),
  });
});

// Handle published messages
aedes.on("publish", async (packet, client) => {
  if (!client?.user?._id) return;

  const userId = client.user._id;

  // Handle chat messages
  if (packet.topic.startsWith("chat/")) {
    try {
      const messageData = JSON.parse(packet.payload.toString());

      if (!messageData?.receiver?._id || !messageData?.message) {
        return;
      }

      const receiverId = messageData.receiver._id;

      // Check mutual follow before processing message
      const areMutualFollowers = await checkMutualFollow(userId, receiverId);
      if (!areMutualFollowers) {
        console.log("Users are not mutual followers, message rejected");
        return;
      }

      // Save message to file
      await saveChatData(userId, receiverId, messageData.message);

      // Create chat message in database
      const chatMessage = new ChatMessage({
        sender: {
          _id: userId,
          email: client.user.email,
          name: messageData.sender?.name || "",
          picture: messageData.sender?.picture || "",
        },
        receiver: {
          _id: receiverId,
          email: messageData.receiver.email,
          name: messageData.receiver.name || "",
          picture: messageData.receiver.picture || "",
        },
        message: messageData.message,
        read: false,
      });

      await chatMessage.save();

      // Create notification
      const notification = new Notification({
        recipient: {
          _id: receiverId,
          email: messageData.receiver.email,
        },
        sender: {
          _id: userId,
          email: client.user.email,
          name: messageData.sender?.name || "",
          picture: messageData.sender?.picture || "",
        },
        type: "message",
        content: `New message from ${messageData.sender?.name || "Someone"}`,
        metadata: {
          messageId: chatMessage._id.toString(),
          chatTopic: packet.topic,
        },
      });

      await notification.save();

      // Publish notification
      aedes.publish({
        topic: `user/${receiverId}/notifications`,
        payload: JSON.stringify(notification),
      });

      // Send message update
      const messageUpdate = {
        type: "new_message",
        message: {
          ...chatMessage.toObject(),
          message: messageData.message,
        },
      };

      [userId, receiverId].forEach((id) => {
        aedes.publish({
          topic: `user/${id}/messages`,
          payload: JSON.stringify(messageUpdate),
        });
      });
    } catch (error) {
      console.error("Error processing chat message:", error);
    }
  }
});

module.exports = aedes;
