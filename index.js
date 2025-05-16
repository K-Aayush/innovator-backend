// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const net = require("net");
const App = require("./src/App");
const DB = require("./src/config/connectDB");
const aedes = require("./src/utils/mqtt/mqttHandler");

// make an app
const app = express();
const server = http.createServer(app);

// Create MQTT server
const mqttServer = net.createServer(aedes.handle);

// use middlewares
app.use(
  cors({
    origin: process.env.WEB_HOST || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  }),
  express.json({ limit: "200gb" }),
  express.urlencoded({ extended: true, limit: "200gb" })
);

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/shop", express.static(path.join(process.cwd(), "shop")));
app.use(
  "/courses/public",
  express.static(path.join(process.cwd(), "courses/public"))
);

// configs
DB();

// calling main App
App(app);

// Start MQTT server
const MQTT_PORT = process.env.MQTT_PORT || 1883;
mqttServer.listen(MQTT_PORT, () => {
  console.log(`MQTT broker running on port ${MQTT_PORT}`);
});

server.listen(process.env.PORT, (error) => {
  if (error) {
    console.error("Error in listening Server:", error);
  } else {
    console.log("Server connected in:", process.env.PORT);
  }
});
