const { Server } = require("socket.io");
const ChatMessage = require("../../modules/chat/chat.model");
const User = require("../../modules/user/user.model");
const Follow = require("../../modules/follow/follow.model");
const Notification = require("../../modules/notifications/notification.model");
const jwt = require("jsonwebtoken");

const setupSocketHandlers = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.WEB_HOST,
      methods: ["GET", "POST"],
    },
  });

  // Track online users and their typing status
  const onlineUsers = new Map();
  const typingUsers = new Map();

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        throw new Error("Authentication token is missing!");
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded._id)
        .select("_id email name picture")
        .lean();

      if (!user) {
        throw new Error("User not found");
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.user.email}`);

    // Add user to online users
    onlineUsers.set(socket.user.email, socket.id);

    // Broadcast user's online status to their followers
    io.emit("user_online", {
      email: socket.user.email,
      name: socket.user.name,
      picture: socket.user.picture,
    });

    // Handle private messages
    socket.on("private_message", async (data) => {
      try {
        const { receiver, message } = data;

        // Verify mutual follow relationship
        const [followA, followB] = await Promise.all([
          Follow.findOne({
            "follower.email": socket.user.email,
            "following.email": receiver.email,
          }),
          Follow.findOne({
            "follower.email": receiver.email,
            "following.email": socket.user.email,
          }),
        ]);

        if (!followA || !followB) {
          socket.emit("error", {
            message: "You can only chat with mutual followers",
            code: "NOT_MUTUAL_FOLLOWERS",
          });
          return;
        }

        // Create and save the message
        const newMessage = new ChatMessage({
          sender: {
            _id: socket.user._id,
            email: socket.user.email,
            name: socket.user.name,
            picture: socket.user.picture,
          },
          receiver: {
            _id: receiver._id,
            email: receiver.email,
            name: receiver.name,
            picture: receiver.picture,
          },
          message,
          read: false,
        });

        await newMessage.save();

        // Create notification
        const notification = new Notification({
          recipient: {
            _id: receiver._id,
            email: receiver.email,
          },
          sender: {
            _id: socket.user._id,
            email: socket.user.email,
            name: socket.user.name,
            picture: socket.user.picture,
          },
          type: "message",
          content: `${socket.user.name} sent you a message`,
          metadata: {
            itemId: newMessage._id.toString(),
            itemType: "message",
          },
        });

        await notification.save();

        // Get receiver's socket if they're online
        const receiverSocketId = onlineUsers.get(receiver.email);

        // Send to receiver if online
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("new_message", {
            ...newMessage.toObject(),
            message: newMessage.decryptMessage(),
          });
          io.to(receiverSocketId).emit("new_notification", notification);
        }

        // Send delivery confirmation to sender
        socket.emit("message_sent", {
          messageId: newMessage._id,
          status: receiverSocketId ? "delivered" : "sent",
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("Message error:", error);
        socket.emit("error", {
          message: "Failed to send message",
          code: "SEND_FAILED",
        });
      }
    });

    // Handle typing status
    socket.on("typing_start", async (data) => {
      try {
        const { receiver } = data;

        // Add to typing users map
        typingUsers.set(`${socket.user.email}-${receiver.email}`, Date.now());

        const receiverSocketId = onlineUsers.get(receiver.email);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("user_typing", {
            user: {
              email: socket.user.email,
              name: socket.user.name,
            },
          });
        }

        // Clear typing status after 3 seconds of no updates
        setTimeout(() => {
          const lastType = typingUsers.get(
            `${socket.user.email}-${receiver.email}`
          );
          if (lastType && Date.now() - lastType >= 3000) {
            typingUsers.delete(`${socket.user.email}-${receiver.email}`);
            if (receiverSocketId) {
              io.to(receiverSocketId).emit("user_stopped_typing", {
                user: socket.user.email,
              });
            }
          }
        }, 3000);
      } catch (error) {
        console.error("Typing status error:", error);
      }
    });

    // Handle read receipts
    socket.on("mark_read", async (data) => {
      try {
        const { messageId } = data;

        const message = await ChatMessage.findByIdAndUpdate(
          messageId,
          {
            read: true,
            readAt: new Date(),
          },
          { new: true }
        );

        if (message) {
          // Notify sender their message was read
          const senderSocketId = onlineUsers.get(message.sender.email);
          if (senderSocketId) {
            io.to(senderSocketId).emit("message_read", {
              messageId,
              readAt: message.readAt,
            });
          }
        }
      } catch (error) {
        console.error("Read receipt error:", error);
        socket.emit("error", {
          message: "Failed to mark message as read",
          code: "READ_FAILED",
        });
      }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.user.email}`);

      // Remove from online users
      onlineUsers.delete(socket.user.email);

      // Clear any typing indicators
      for (const [key, _] of typingUsers) {
        if (key.startsWith(socket.user.email)) {
          typingUsers.delete(key);
        }
      }

      // Broadcast offline status
      io.emit("user_offline", {
        email: socket.user.email,
        timestamp: new Date(),
      });
    });
  });

  return io;
};

module.exports = setupSocketHandlers;
