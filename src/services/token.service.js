import jwt from "jsonwebtoken";
import crypto from "crypto";
import pool from "../db.js";

export function signAccessToken(payload) {
    return jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "15m",
    });
}

export function signRefreshToken(payload) {
    return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: "30d",
    });
}

export function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export async function saveRefreshToken({ userId, token, ua, ip }) {
    const hashed = hashToken(token);
    await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address)
     VALUES ($1,$2,$3,$4)`,
        [userId, hashed, ua, ip]
    );
}
