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
          click_action:
            notification.click_action || "FLUTTER_NOTIFICATION_CLICK",
          screen: notification.screen || "home",
          ...this._sanitizeData(notification.data || {}),
        },
        android: {
          notification: {
            icon: "notification_icon",
            color: "#4A90E2",
            sound: "default",
            priority: "high",
            channelId: this._getChannelId(notification.type),
            visibility: "public",
            importance: "high",
            vibrationPattern: [0, 250, 250, 250],
          },
          priority: "high",
        },
        apns: {
          headers: {
            "apns-priority": "10",
          },
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              badge: 1,
              sound: "default",
              "mutable-content": 1,
              "content-available": 1,
              category: notification.type,
            },
          },
        },
        webpush: {
          notification: {
            icon: notification.image || "/icon.png",
            badge: "/badge.png",
            vibrate: [100, 50, 100],
            requireInteraction: true,
          },
          fcmOptions: {
            link: notification.click_action,
          },
        },
        tokens: user.fcmTokens,
      };

      const response = await firebaseAdmin
        .messaging()
        .sendEachForMulticast(message);

      if (response.failureCount > 0) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.error(
              `FCM send failed for token: ${user.fcmTokens[idx]}`,
              resp.error
            );
            invalidTokens.push(user.fcmTokens[idx]);
          }
        });

        if (invalidTokens.length > 0) {
          await User.updateOne(
            { _id: userId },
            { $pull: { fcmTokens: { $in: invalidTokens } } }
          );
          console.log(
            `Removed ${invalidTokens.length} invalid tokens for user ${userId}`
          );
        }
      }

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (error) {
      console.error("Error sending FCM notification:", error);
      throw error;
    }
  }

  static _getChannelId(type) {
    const highPriorityTypes = ["message", "like", "comment"];
    return highPriorityTypes.includes(type)
      ? "high_importance_channel"
      : "regular_channel";
  }

  static _sanitizeData(data) {
    // Convert all values to strings to ensure FCM compatibility
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] =
        typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    return sanitized;
  }

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
          click_action:
            notification.click_action || "FLUTTER_NOTIFICATION_CLICK",
          screen: notification.screen || "home",
          ...this._sanitizeData(notification.data || {}),
        },
        android: {
          notification: {
            icon: "notification_icon",
            color: "#4A90E2",
            sound: "default",
            priority: "high",
            channelId: this._getChannelId(notification.type),
            visibility: "public",
            importance: "high",
            vibrationPattern: [0, 250, 250, 250],
          },
          priority: "high",
        },
        apns: {
          headers: {
            "apns-priority": "10",
          },
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              badge: 1,
              sound: "default",
              "mutable-content": 1,
              "content-available": 1,
              category: notification.type,
            },
          },
        },
        webpush: {
          notification: {
            icon: notification.image || "/icon.png",
            badge: "/badge.png",
            vibrate: [100, 50, 100],
            requireInteraction: true,
          },
          fcmOptions: {
            link: notification.click_action,
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
            console.error(
              `FCM send failed for token: ${tokens[idx]}`,
              resp.error
            );
            invalidTokens.push(tokens[idx]);
          }
        });

        if (invalidTokens.length > 0) {
          await User.updateMany(
            { fcmTokens: { $in: invalidTokens } },
            { $pull: { fcmTokens: { $in: invalidTokens } } }
          );
          console.log(`Removed ${invalidTokens.length} invalid tokens`);
        }
      }

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
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
          click_action:
            notification.click_action || "FLUTTER_NOTIFICATION_CLICK",
          screen: notification.screen || "home",
          ...this._sanitizeData(notification.data || {}),
        },
        android: {
          notification: {
            icon: "notification_icon",
            color: "#4A90E2",
            sound: "default",
            priority: "high",
            channelId: this._getChannelId(notification.type),
            visibility: "public",
            importance: "high",
            vibrationPattern: [0, 250, 250, 250],
          },
          priority: "high",
        },
        apns: {
          headers: {
            "apns-priority": "10",
          },
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              badge: 1,
              sound: "default",
              "mutable-content": 1,
              "content-available": 1,
              category: notification.type,
            },
          },
        },
        webpush: {
          notification: {
            icon: notification.image || "/icon.png",
            badge: "/badge.png",
            vibrate: [100, 50, 100],
            requireInteraction: true,
          },
          fcmOptions: {
            link: notification.click_action,
          },
        },
        topic,
      };

      const response = await firebaseAdmin.messaging().send(message);
      return { success: true, messageId: response };
    } catch (error) {
      console.error("Error sending FCM topic notification:", error);
      throw error;
    }
  }
}

module.exports = FCMHandler;
