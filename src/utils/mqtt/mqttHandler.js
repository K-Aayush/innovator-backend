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
    console.log("Base chat directory structure created successfully");
  } catch (error) {
    console.error(
      "Error creating base chat directory:",
      error.message,
      error.stack
    );
  }
})();

// Generate chat ID from user IDs
function generateChatId(...userIds) {
  console.log(`Generating chat ID for users: ${userIds.join(", ")}`);
  return userIds.sort().join("_");
}

// Check if users are mutual followers
async function checkMutualFollow(user1Id, user2Id) {
  try {
    console.log(`Checking mutual follow for users: ${user1Id}, ${user2Id}`);
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
    const isMutual = !!follow1 && !!follow2;
    console.log(
      `Mutual follow check result for ${user1Id}, ${user2Id}: ${isMutual}`
    );
    return isMutual;
  } catch (error) {
    console.error(
      `Error checking mutual follow for ${user1Id}, ${user2Id}:`,
      error.message,
      error.stack
    );
    return false;
  }
}

// Save chat message to file
async function saveChatData(senderId, receiverId, message) {
  try {
    console.log(
      `Saving chat data for sender: ${senderId}, receiver: ${receiverId}`
    );
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
      console.log(`Loaded existing chat file: ${chatFile}`);
    } catch (error) {
      console.log(`No existing chat file for ${chatId}, creating new one`);
    }

    chatData.messages.push({
      senderId,
      message: ChatMessage.encryptMessage(message),
      timestamp: new Date(),
    });

    await fs.writeFile(chatFile, JSON.stringify(chatData, null, 2));
    console.log(`Chat data saved successfully for chatId: ${chatId}`);
    return chatData;
  } catch (error) {
    console.error(
      `Error saving chat data for sender: ${senderId}, receiver: ${receiverId}:`,
      error.message,
      error.stack
    );
    throw error;
  }
}

// Authenticate mqtt clients using jwt
aedes.authenticate = async (client, username, password, callback) => {
  try {
    console.log(`Authenticating client with username: ${username}`);
    const token = password.toString();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    client.user = decoded;
    console.log(`Client authenticated successfully: ${decoded._id}`);
    callback(null, true);
  } catch (error) {
    console.error(
      `Authentication error for username: ${username}:`,
      error.message,
      error.stack
    );
    callback(error, false);
  }
};

// Handle client connections
aedes.on("client", async (client) => {
  if (!client.user?._id) {
    console.warn("Client connected without valid user ID");
    return;
  }

  const userId = client.user._id;
  console.log(`Client connected: ${userId}, client ID: ${client.id}`);
  onlineClients.set(userId, client.id);

  // Initialize user's chat set if not exists
  if (!userChats.has(userId)) {
    userChats.set(userId, new Set());
    console.log(`Initialized chat set for user: ${userId}`);
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
    console.log(
      `Resubscribing to active chats for ${userId}:`,
      Array.from(activeChats)
    );
  }

  for (const topic of personalTopics) {
    console.log(`Subscribing client ${userId} to topic: ${topic}`);
    client.subscribe({ topic, qos: 0 }, () => {});
  }

  // Publish online status
  console.log(`Publishing online status for ${userId}`);
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
  if (!client.user?._id) {
    console.warn("Client disconnected without valid user ID");
    return;
  }

  const userId = client.user._id;
  console.log(`Client disconnected: ${userId}, client ID: ${client.id}`);
  onlineClients.delete(userId);

  // Publish offline status
  console.log(`Publishing offline status for ${userId}`);
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
  if (!client?.user?._id) {
    console.warn("Publish event received from client without valid user ID");
    return;
  }

  const userId = client.user._id;
  console.log(`Processing publish from ${userId} on topic: ${packet.topic}`);

  // Handle chat messages
  if (packet.topic.startsWith("chat/")) {
    try {
      console.log(`Parsing chat message payload: ${packet.payload.toString()}`);
      const messageData = JSON.parse(packet.payload.toString());

      if (!messageData?.receiver?._id || !messageData?.message) {
        console.warn("Invalid message data: missing receiver ID or message");
        return;
      }

      const receiverId = messageData.receiver._id;
      console.log(`Processing message from ${userId} to ${receiverId}`);

      // Check mutual follow before processing message
      const areMutualFollowers = await checkMutualFollow(userId, receiverId);
      if (!areMutualFollowers) {
        console.warn(
          `Users ${userId} and ${receiverId} are not mutual followers, message rejected`
        );
        return;
      }

      // Save message to file
      await saveChatData(userId, receiverId, messageData.message);
      console.log(`Chat data saved for ${userId} to ${receiverId}`);

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
      console.log(`Chat message saved to database, ID: ${chatMessage._id}`);

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
      console.log(
        `Notification created for ${receiverId}, ID: ${notification._id}`
      );

      // Publish notification
      console.log(`Publishing notification to ${receiverId}`);
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
        console.log(`Publishing message update to user: ${id}`);
        aedes.publish({
          topic: `user/${id}/messages`,
          payload: JSON.stringify(messageUpdate),
        });
      });
    } catch (error) {
      console.error(
        `Error processing chat message from ${userId} on topic ${packet.topic}:`,
        error.message,
        error.stack
      );
    }
  }
});

module.exports = aedes;
