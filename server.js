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
app.get("/", async (req, res) => {
    const result = await pool.query("SELECT NOW()");
    res.json({ now: result.rows[0] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
