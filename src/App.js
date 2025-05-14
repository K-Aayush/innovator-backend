const users = require("./modules/user/user.routes.js");
const contents = require("./modules/contents/contents.routes.js");
const comments = require("./modules/comments/comments.routes.js");
const fallback = require("./reusables/fallbacks.js");
const like = require("./modules/likes/likes.routes.js");
const follow = require("./modules/follow/follow.route.js");
const courses = require("./modules/courses/course.routes.js");
const admin = require("./modules/admin/admin.routes.js");
const shop = require("./modules/shop/shop.routes");
const chat = require("./modules/chat/chat.routes");
const notifications = require("./modules/notifications/notification.routes");
const { AccessPrivateFiles } = require("./modules/private-file/access.js");

const App = (app) => {
  // use routes
  app.use(
    "/api/v1",
    users,
    contents,
    comments,
    like,
    follow,
    courses,
    admin,
    shop,
    chat,
    notifications
  );

  app.use("/courses/private/:subfolder/:filename", AccessPrivateFiles);

  app.use("/", (_, res) => {
    return res.send(fallback);
  });

  return app;
};

module.exports = App;
