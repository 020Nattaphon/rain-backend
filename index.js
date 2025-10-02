// index.js (backend)
require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "";

// ✅ เชื่อม MongoDB
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err.message));

// ✅ Schema เก็บข้อมูล
const rainSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  temperature: Number,
  humidity: Number,
  rain_detected: Boolean,
  alert_sent: Boolean,
  device_id: String,
});
const Rain = mongoose.model("Rain", rainSchema);

// ✅ HTTP + Socket.IO (รองรับ real-time dashboard)
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "*" },
});

io.on("connection", (socket) => {
  console.log("📡 Client connected", socket.id);
  socket.on("disconnect", () => console.log("📴 Client disconnected", socket.id));
});

// ✅ ฟังก์ชันวิเคราะห์ฝน (rule เบื้องต้น ปรับได้)
function analyzeRain(temperature, humidity) {
  if (typeof temperature !== "number" || typeof humidity !== "number")
    return false;
  // กำหนดเงื่อนไขฝนตก: ความชื้น > 80 และอุณหภูมิ 24–30
  if (humidity > 80 && temperature >= 24 && temperature <= 30) return true;
  return false;
}

// ✅ POST endpoint: รับข้อมูลจาก ESP32
app.post("/api/data", async (req, res) => {
  try {
    const { temperature, humidity, device_id } = req.body;
    const rain_detected = analyzeRain(temperature, humidity);

    const doc = new Rain({
      temperature,
      humidity,
      rain_detected,
      alert_sent: false,
      device_id: device_id || "ESP32-01",
    });

    await doc.save();

    // ส่ง alert แบบ real-time
    if (rain_detected) {
      const payload = {
        id: doc._id,
        timestamp: doc.timestamp,
        temperature: doc.temperature,
        humidity: doc.humidity,
        device_id: doc.device_id,
        message: `🌧 Rain detected at ${doc.device_id}`,
      };
      io.emit("rain_alert", payload);

      doc.alert_sent = true;
      await doc.save();
    }

    res.status(201).json({ message: "✅ Data saved", rain_detected });
  } catch (err) {
    console.error("❌ POST /api/data error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET: ดึงข้อมูลทั้งหมด
app.get("/api/data", async (req, res) => {
  try {
    const data = await Rain.find().sort({ timestamp: -1 }).limit(1000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET: ดึงสถิติฝนตกใน 1 เดือน
app.get("/api/stats/month", async (req, res) => {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const rains = await Rain.find({
      rain_detected: true,
      timestamp: { $gte: oneMonthAgo },
    }).sort({ timestamp: -1 });

    res.json({
      total_rain: rains.length,
      details: rains,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ start server
server.listen(PORT, () =>
  console.log(`🚀 Backend running on http://localhost:${PORT}`)
);
