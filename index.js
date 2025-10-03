// index.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "";

// ✅ Connect MongoDB
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

// ✅ HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "*" },
});

io.on("connection", (socket) => {
  console.log("📡 Client connected", socket.id);
  socket.on("disconnect", () =>
    console.log("📴 Client disconnected", socket.id)
  );
});

// ✅ ฟังก์ชันวิเคราะห์ฝน
function analyzeRain(temperature, humidity) {
  if (typeof temperature !== "number" || typeof humidity !== "number")
    return false;
  return humidity > 80 && temperature >= 24 && temperature <= 30;
}

// ✅ POST: รับข้อมูลจาก ESP
app.post("/api/data", async (req, res) => {
  try {
    const { temperature, humidity, device_id } = req.body;
    const rain_detected = analyzeRain(temperature, humidity);

    const doc = new Rain({
      temperature,
      humidity,
      rain_detected,
      alert_sent: false,
      device_id: device_id || "ESP-01",
    });

    await doc.save();

    if (rain_detected) {
      const payload = {
        id: doc._id,
        timestamp: doc.timestamp,
        temperature: doc.temperature,
        humidity: doc.humidity,
        device_id: doc.device_id,
        message: `🌧️ Rain detected at ${doc.device_id}`,
      };
      io.emit("rain_alert", payload);
      doc.alert_sent = true;
      await doc.save();
    }

    res.status(201).json({ message: "✅ Data saved", rain_detected });
  } catch (err) {
    console.error("POST /api/data error:", err);
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

// ✅ GET: สถิติใน 1 เดือน
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

// ✅ GET: แสดง QR Code ของ Frontend
app.get("/qrcode", async (req, res) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL || "https://rain-frontend.onrender.com";

    const qr = await QRCode.toDataURL(frontendUrl);
    res.send(`
      <html>
        <body style="text-align:center; font-family:Arial;">
          <h2>📱 Scan QR Code เพื่อเปิด RainApp</h2>
          <img src="${qr}" />
          <p><a href="${frontendUrl}" target="_blank">${frontendUrl}</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).json({ error: "❌ ไม่สามารถสร้าง QR Code ได้" });
  }
});

// ✅ Start server
server.listen(PORT, () =>
  console.log(`🚀 Backend running on http://localhost:${PORT}`)
);
