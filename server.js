import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();

// Kết nối PostgreSQL (lấy connection string trong Aiven)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // để tiện dùng biến môi trường
    ssl: { rejectUnauthorized: false }          // Aiven yêu cầu SSL
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
