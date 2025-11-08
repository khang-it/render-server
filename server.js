// server.js
import express from "express";
import cors from "cors";
import { WS } from "./websocket.js";

// import pkg from "pg";
// const { Pool } = pkg;
// const PORT = process.env.PORT || 3000;
// const pool = new Pool({
//     connectionString: process.env.DATABASE_URL,
//     ssl: { rejectUnauthorized: false }
// });
import pool from './db.js';

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());

// API test
app.get("/echo", async (req, res) => {
    try {
        const { msg = "Xin chào!! 8/11 10:05" } = req.query;

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

// GET /messages?before=<created_at>&limit=50
app.get('/messages', async (req, res) => {
    const { before, limit = 50, userId } = req.query;


    console.log('get message', before, limit, userId)

    try {
        const params = [userId];
        let sql = `SELECT * FROM messages WHERE (sender_id = $1 OR receiver_id = $1)`;

        if (before) {
            sql += ` AND created_at < $2`;
            params.push(before);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const { rows } = await pool.query(sql, params);

        res.json(rows.reverse().map(msg => ({
            id: msg.id,
            senderId: msg.sender_id,
            receiverId: msg.receiver_id,
            message: msg.content,
            created_at: msg.created_at
        })));
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading messages');
    }
});


// --- WebSocket attach ---
WS(app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
}), pool);