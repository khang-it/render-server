// server.js
import express from "express";
import pkg from "pg";
import { WebSocketServer } from "ws";
import cors from "cors";

const { Pool } = pkg;
const app = express();


const PORT = process.env.PORT || 3000;

// Kết nối PostgreSQL (lấy connection string trong Aiven)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // để tiện dùng biến môi trường
    ssl: { rejectUnauthorized: false }          // Aiven yêu cầu SSL
});

app.use(cors());


// API test
app.get("/echo", async (req, res) => {
    try {
        const { msg = "Xin chào!" } = req.query;

        res.json({
            success: true,
            echo: msg,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("Echo error:", err);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
});

app.get("/users", async (req, res) => {
    console.log("Received request", new Date().toISOString());

    try {
        // Query lấy name, email từ bảng users
        const result = await pool.query("SELECT name, email FROM users");

        res.json({
            success: true,
            count: result.rows.length,
            users: result.rows
        });
    } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
});

// API test
app.get("/", async (req, res) => {
    console.log("Received request", new Date());
    const result = await pool.query("SELECT NOW()");
    res.json({ now: result.rows[0] });
});


const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// ---- WebSocket dùng chung server này ----
const wss = new WebSocketServer({ server });
let clientId = 0;

wss.on("connection", (ws) => {
    clientId++;
    ws.id = clientId;
    console.log(`✅ Client #${ws.id} connected`);

    ws.send(`👋 Welcome! You are User #${ws.id}`);

    ws.on("message", (msg) => {
        const text = msg.toString();
        console.log(`📩 [User #${ws.id}] ${text}`);

        // Gửi lại cho tất cả client, kể cả người gửi
        wss.clients.forEach((client) => {
            if (client.readyState === ws.OPEN) {
                const prefix = client === ws ? "You" : `User #${ws.id}`;
                client.send(`${prefix}: ${text}`);
            }
        });
    });

    ws.on("close", () => {
        console.log(`❌ Client #${ws.id} disconnected`);
    });
});