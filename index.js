require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const webpush = require("web-push");

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;

// ✅ เชื่อม MongoDB
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err.message));

// ✅ Schema
const rainSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  temperature: Number,
  humidity: Number,
  rain_detected: Boolean,
  alert_sent: Boolean,
  device_id: String,
});
const Rain = mongoose.model("Rain", rainSchema);

// ✅ Web Push Config
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails(
  "mailto:admin@example.com",
  publicVapidKey,
  privateVapidKey
);

let subscriptions = [];

// ✅ Subscribe Notification
app.post("/subscribe", (req, res) => {
  const subscription = req.body;
  subscriptions.push(subscription);
  res.status(201).json({ message: "✅ Subscription added" });
});

// ✅ Unsubscribe Notification
app.post("/unsubscribe", (req, res) => {
  const subscription = req.body;
  subscriptions = subscriptions.filter(
    (sub) => JSON.stringify(sub) !== JSON.stringify(subscription)
  );
  res.json({ message: "🚫 Unsubscribed successfully" });
});

// ✅ ส่ง Notification
function sendNotification(message) {
  subscriptions.forEach((sub, i) => {
    webpush
      .sendNotification(
        sub,
        JSON.stringify({ title: "🌧 Rain Alert", body: message })
      )
      .catch((err) => {
        console.error("❌ Push error:", err);
        subscriptions.splice(i, 1);
      });
  });
}

// ✅ HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || "*" },
});

io.on("connection", (socket) => {
  console.log("📡 Client connected:", socket.id);
  socket.on("disconnect", () =>
    console.log("📴 Client disconnected:", socket.id)
  );
});

// ✅ Rule ตรวจฝน
function analyzeRain(temperature, humidity) {
  if (typeof temperature !== "number" || typeof humidity !== "number")
    return false;
  return humidity > 80 && temperature >= 24 && temperature <= 30;
}

// ✅ Endpoint: POST จาก ESP32
app.post("/api/data", async (req, res) => {
  try {
    const { temperature, humidity, device_id } = req.body;
    const rain_detected = analyzeRain(temperature, humidity);

    const doc = new Rain({
      temperature,
      humidity,
      rain_detected,
      alert_sent: false,
      device_id: device_id || "ESP-32",
    });

    await doc.save();

    // ✅ Broadcast Realtime (clean object)
    io.emit("rain_alert", {
      timestamp: doc.timestamp,
      temperature: doc.temperature,
      humidity: doc.humidity,
      rain_detected: doc.rain_detected,
      device_id: doc.device_id,
    });

    // ✅ ถ้ามีฝน → แจ้งเตือน
    if (rain_detected) {
      const msg = `💧 ความชื้น: ${humidity}% 🌡 Temp: ${temperature}°C (อาจมีฝนตก)`;
      sendNotification(msg);

      doc.alert_sent = true;
      await doc.save();
    }

    res.status(201).json({ message: "✅ Data saved", rain_detected });
  } catch (err) {
    console.error("POST /api/data error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Endpoint: GET ข้อมูลย้อนหลัง
app.get("/api/data", async (req, res) => {
  try {
    const data = await Rain.find().sort({ timestamp: -1 }).limit(1000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Endpoint: GET Stats รายเดือน
app.get("/api/stats/month", async (req, res) => {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const rains = await Rain.find({
      rain_detected: true,
      timestamp: { $gte: oneMonthAgo },
    }).sort({ timestamp: -1 });
    res.json({ total_rain: rains.length, details: rains });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Start Server
server.listen(PORT, () =>
  console.log(`🚀 Backend running on http://localhost:${PORT}`)
);
