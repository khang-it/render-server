// ./src/services/auth.service.js
import pool from "#db";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { hashToken } from '#utils/jwt.js'


// ========================
// 🔐 USER
// ========================

export async function findUserByEmail(email) {
    const r = await pool.query(
        "SELECT * FROM users WHERE email=$1",
        [email.toLowerCase()]
    );
    return r.rows[0] || null;
}

export async function findUserById(id) {
    const r = await pool.query(
        "SELECT id,email,name,avatar,provider FROM users WHERE id=$1",
        [id]
    );
    return r.rows[0] || null;
}

export async function verifyPassword(raw, hashed) {
    return bcrypt.compare(raw, hashed);
}


export async function revokeRefreshToken(token) {
    await pool.query(
        `UPDATE refresh_tokens
     SET revoked_at=NOW()
     WHERE token_hash=$1`,
        [hashToken(token)]
    );
}

// ========================
// REFRESH TOKEN
// ========================

export async function saveRefreshToken({ userId, token, ua, ip }) {
    const decoded = jwt.decode(token);

    if (!decoded?.exp) {
        throw new Error("Invalid refresh token payload");
    }

    const expiresAt = new Date(decoded.exp * 1000);

    await pool.query(
        `INSERT INTO refresh_tokens
     (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1,$2,$3,$4,$5)`,
        [
            userId,
            hashToken(token),
            expiresAt,
            ua,
            ip
        ]
    );
}

// ========================
// CHECK REFRESH VALID
// ========================
export async function verifyRefreshToken(token) {
    try {
        const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
        const hashed = hashToken(token);

        const r = await pool.query(
            `SELECT user_id, expires_at
       FROM refresh_tokens
       WHERE token_hash=$1
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
            [hashed]
        );

        if (!r.rows.length) return null;

        return {
            userId: payload.sub,
            expiresAt: r.rows[0].expires_at
        };
    } catch {
        return null;
    }
}


