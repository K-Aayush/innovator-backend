const { firebaseAdmin } = require("../../config/firebaseAdmin");
const User = require("../../modules/user/user.model");

class FCMHandler {
  static async sendToUser(userId, notification) {
    try {
      const user = await User.findById(userId).select("fcmTokens").lean();

      if (!user?.fcmTokens?.length) {
        console.warn(`No FCM tokens found for user ${userId}`);
        return { success: false, message: "No FCM tokens available" };
      }

      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          image: notification.image || undefined,
        },
        data: {
          type: notification.type,
          click_action: notification.click_action || "",
          ...notification.data,
        },
        android: {
          notification: {
            icon: "notification_icon",
            color: "#4A90E2",
            sound: "default",
            priority: "high",
            channelId: "default",
          },
        },
        apns: {
          payload: {
            aps: {
              "mutable-content": 1,
              sound: "default",
            },
          },
        },
        tokens: user.fcmTokens,
      };

      // Use sendEachForMulticast instead of sendMulticast
      const response = await firebaseAdmin
        .messaging()
        .sendEachForMulticast(message);

      // Handle invalid tokens
      if (response.failureCount > 0) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            invalidTokens.push(user.fcmTokens[idx]);
          }
        });

        if (invalidTokens.length > 0) {
          await User.updateOne(
            { _id: userId },
            { $pull: { fcmTokens: { $in: invalidTokens } } }
          );
          console.log(
            `Removed invalid tokens for user ${userId}:`,
            invalidTokens
          );
        }
      }

      return response;
    } catch (error) {
      console.error("Error sending FCM notification:", error);
      throw error; 
    }
  }

  // Update sendToMultipleUsers similarly
  static async sendToMultipleUsers(userIds, notification) {
    try {
      const users = await User.find({ _id: { $in: userIds } })
        .select("fcmTokens")
        .lean();

      const tokens = users.reduce((acc, user) => {
        if (user.fcmTokens?.length) {
          acc.push(...user.fcmTokens);
        }
        return acc;
      }, []);

      if (!tokens.length) {
        console.warn("No FCM tokens found for users:", userIds);
        return { success: false, message: "No FCM tokens available" };
      }

      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          image: notification.image || undefined,
        },
        data: {
          type: notification.type,
          click_action: notification.click_action || "",
          ...notification.data,
        },
        android: {
          notification: {
            icon: "notification_icon",
            color: "#4A90E2",
            sound: "default",
            priority: "high",
            channelId: "default",
          },
        },
        apns: {
          payload: {
            aps: {
              "mutable-content": 1,
              sound: "default",
            },
          },
        },
        tokens,
      };

      const response = await firebaseAdmin
        .messaging()
        .sendEachForMulticast(message);

      if (response.failureCount > 0) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            invalidTokens.push(tokens[idx]);
          }
        });

        if (invalidTokens.length > 0) {
          await User.updateMany(
            { fcmTokens: { $in: invalidTokens } },
            { $pull: { fcmTokens: { $in: invalidTokens } } }
          );
          console.log("Removed invalid tokens:", invalidTokens);
        }
      }

      return response;
    } catch (error) {
      console.error("Error sending FCM notifications:", error);
      throw error;
    }
  }

  static async sendToTopic(topic, notification) {
    try {
      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          image: notification.image || undefined,
        },
        data: {
          type: notification.type,
          click_action: notification.click_action || "",
          ...notification.data,
        },
        android: {
          notification: {
            icon: "notification_icon",
            color: "#4A90E2",
            sound: "default",
            priority: "high",
            channelId: "default",
          },
        },
        apns: {
          payload: {
            aps: {
              "mutable-content": 1,
              sound: "default",
            },
          },
        },
        topic,
      };

      return await firebaseAdmin.messaging().send(message);
    } catch (error) {
      console.error("Error sending FCM topic notification:", error);
      throw error;
    }
  }
}

module.exports = FCMHandler;
