import pool from "./db.js";

(async () => {
    try {
        const res = await pool.query("SELECT NOW()");
        console.log("✅ DB connected:", res.rows[0]);
        process.exit(0);
    } catch (err) {
        console.error("❌ DB error:", err);
        process.exit(1);
    }
})();