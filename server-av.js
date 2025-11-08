// server.js
import express from "express";
import cors from "cors";
import { WS } from "./websocket.js";
import pool from "./db.js"; // chỗ export pool

const app = express();

const PORT = process.env.PORT || 3000;

// Kết nối PostgreSQL (lấy connection string trong Aiven)
let poolConfig = {
    connectionString: process.env.DATABASE_URL,
};

if (process.env.NODE_ENV === "production") {
    poolConfig.ssl = { rejectUnauthorized: false };
}

app.use(cors());


// API test
app.get("/echo", async (req, res) => {
    try {
        const { msg = "Xin chào!!" } = req.query;

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
        const result = await pool.query("SELECT name, email FROM account");

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

// websocket
await WS(server, pool);