// import dotenv from "dotenv";
// dotenv.config();
import pool from "./db.js";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

import passport from "passport";
import GoogleStrategy from "passport-google-oauth20";

import { requestLogger } from "./middleware/requestLogger.js";

import { WS } from "./websocket.js";

const app = express();
app.use(express.json());
app.use(cookieParser());

// =====================================
// ✅ CORS DÙNG CHO FRONTEND HTTPS LOCAL
// =====================================
const FRONTEND_URL = "https://localhost:12345";

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            const allowedOrigins = [
                'http://localhost:12345',
                'https://localhost:12345',
                'https://wh.io.vn',
                'https://render-server-ezuf.onrender.com'
            ];
            if (allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error(`CORS blocked for origin: ${origin}`));
            }
        },
        credentials: true,
    })
);

// =====================================
// ✅ GẮN MIDDLEWARE GHI LOG
// =====================================
app.use(requestLogger);

// ================================
// ✅ JWT helpers
// ================================
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_DAYS = 30;

function signAccessToken(payload) {
    return jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: ACCESS_TOKEN_TTL,
    });
}

function signRefreshToken(payload) {
    return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: `${REFRESH_TOKEN_DAYS}d`,
    });
}

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

// ========================================================
// ✅ COOKIE CHUẨN CHO HTTPS LOCAL
// ========================================================
function setRefreshCookie(res, token) {
    const isLocal = process.env.NODE_ENV !== "production";
    console.log('isLocal:', isLocal)
    res.cookie("refreshToken", token, {
        httpOnly: true,
        secure: !isLocal,         // ✅ chỉ bật secure khi production
        sameSite: "None",
        maxAge: REFRESH_TOKEN_DAYS * 86400000,
        path: "/",
    });
}

async function saveRefreshToken({ userId, token, ua, ip }) {
    const hashed = hashToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400000);

    await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, hashed, expiresAt, ua, ip]
    );
}

async function revokeRefreshToken(token) {
    const hashed = hashToken(token);
    await pool.query(
        `UPDATE refresh_tokens 
         SET revoked_at = NOW() 
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashed]
    );
}

async function revokeAllTokensForUser(userId) {
    await pool.query(
        `UPDATE refresh_tokens 
         SET revoked_at = NOW() 
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
    );
}

async function isRefreshValid(token) {
    try {
        const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
        const hashed = hashToken(token);

        const r = await pool.query(
            `SELECT * FROM refresh_tokens 
             WHERE token_hash = $1 
             AND revoked_at IS NULL 
             AND expires_at > NOW()`,
            [hashed]
        );

        if (r.rows.length === 0) return null;
        return { userId: payload.sub };
    } catch {
        return null;
    }
}

function issueTokensAndRespond(res, user, options = { includeAccessInBody: true }) {
    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    const refreshToken = signRefreshToken({ sub: user.id });

    setRefreshCookie(res, refreshToken);

    if (options.includeAccessInBody) {
        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar || null,
                provider: user.provider || "local",
            },
            accessToken,
            expiresIn: ACCESS_TOKEN_TTL,
        });
    }

    return { accessToken, refreshToken };
}

// ================================
// ✅ Middleware
// ================================
function authBearer(req, res, next) {
    const h = req.headers.authorization || "";
    const [, token] = h.split(" ");

    if (!token) return res.status(401).json({ error: "Missing token" });

    try {
        const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        req.user = payload;
        next();
    } catch {
        return res.status(401).json({ error: "Invalid token" });
    }
}

// ================================
// ✅ AUTH ROUTES
// ================================

// ========================================================
// ✅ ADMIN ROUTES: Token Management
// ========================================================

// 🧩 Revoke all refresh tokens by user id
app.post("/auth/revoke-by-account-id/:id", async (req, res) => {
    const userId = req.params.id;

    try {
        await pool.query(
            `UPDATE refresh_tokens
             SET revoked_at = NOW()
             WHERE user_id = $1 AND revoked_at IS NULL`,
            [userId]
        );

        res.json({
            success: true,
            message: `Đã thu hồi toàn bộ refresh token của user_id=${userId}`,
        });
    } catch (err) {
        console.error("Revoke by account id error:", err);
        res.status(500).json({
            success: false,
            error: "Không thể thu hồi token",
        });
    }
});

// 🧹 Clean up old or expired tokens
app.delete("/auth/clean-token", async (req, res) => {
    const days = parseInt(req.query.days || "7", 10);
    try {
        const { rowCount } = await pool.query(
            `
            DELETE FROM refresh_tokens
            WHERE expires_at < NOW()
               OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '${days} days')
            `
        );

        res.json({
            success: true,
            message: `Đã xoá ${rowCount} token hết hạn hoặc đã thu hồi quá ${days} ngày.`,
        });
    } catch (err) {
        console.error("Clean token error:", err);
        res.status(500).json({
            success: false,
            error: "Không thể dọn dẹp token",
        });
    }
});


app.get("/auth/create-pwd", async (req, res) => {
    const password = req.query.password;
    if (!password) {
        return res.status(400).json({ error: "Thiếu password" });
    }

    try {
        const hashed = await bcrypt.hash(password, 10);
        return res.json({ password, hashed });
    } catch (err) {
        return res.status(500).json({ error: "Không tạo được mật khẩu" });
    }
});

app.post("/auth/register", async (req, res) => {
    const { name, email, password } = req.body;

    const lower = email.toLowerCase().trim();
    const exists = await pool.query("SELECT id FROM users WHERE email=$1", [lower]);

    if (exists.rows.length > 0)
        return res.status(409).json({ error: "Email đã tồn tại" });

    const hashed = await bcrypt.hash(password, 10);

    const ins = await pool.query(
        `INSERT INTO users (name, email, password, provider)
         VALUES ($1,$2,$3,$4)
         RETURNING id, name, email, avatar, provider`,
        [name, lower, hashed, "local"]
    );

    res.status(201).json({ user: ins.rows[0] });
});

app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;

    console.log('info:', email, password)
    const lower = email.toLowerCase().trim();
    const r = await pool.query("SELECT * FROM users WHERE email=$1", [lower]);
    console.log('info1:', r.rows)
    if (r.rows.length === 0)
        return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });

    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    console.log('info2:', ok)
    if (!ok)
        return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });

    const { accessToken, refreshToken } = issueTokensAndRespond(res, user);

    await saveRefreshToken({
        userId: user.id,
        token: refreshToken,
        ua: req.headers["user-agent"],
        ip: req.socket.remoteAddress,
    });
});

app.get("/auth/me", async (req, res) => {
    const refresh = req.cookies.refreshToken;
    console.log('refresh:', refresh)
    if (!refresh) return res.status(401).json({ user: null });
    const valid = await isRefreshValid(refresh);
    if (!valid) return res.status(401).json({ user: null });

    const r = await pool.query(
        "SELECT id, email, name, avatar, provider FROM users WHERE id=$1",
        [valid.userId]
    );

    const user = r.rows[0];
    const accessToken = signAccessToken({ sub: user.id, email: user.email });

    return res.json({ user, accessToken });
});

app.post("/auth/logout", async (req, res) => {
    const refresh = req.cookies.refreshToken;
    if (refresh) await revokeRefreshToken(refresh);

    res.clearCookie("refreshToken", { path: "/" });
    res.json({ ok: true });
});

app.get("/api/profile", authBearer, async (req, res) => {
    const r = await pool.query(
        "SELECT id, email, name, avatar, provider FROM users WHERE id=$1",
        [req.user.sub]
    );
    res.json({ user: r.rows[0] });
});

// ================================
// ✅ ORIGINAL API (messages, etc.)
// ================================

app.get("/echo", async (req, res) => {
    try {
        const { msg = "Xin chào!! Hello" } = req.query;
        res.json({ success: true, echo: msg, timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

app.get("/users", async (req, res) => {
    try {
        const result = await pool.query("SELECT name, email FROM account");
        console.log('users:', result.rows.length, new Date().getTime())
        res.json({
            success: true,
            count: result.rows.length,
            users: result.rows,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

app.get("/", async (req, res) => {
    const result = await pool.query("SELECT NOW()");
    res.json({ now: result.rows[0] });
});

// GET /messages
app.get("/messages", async (req, res) => {
    const { before, limit = 50, userId } = req.query;

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

        res.json(
            rows.reverse().map((msg) => ({
                id: msg.id,
                senderId: msg.sender_id,
                receiverId: msg.receiver_id,
                message: msg.content,
                created_at: msg.created_at,
            }))
        );
    } catch (err) {
        res.status(500).send("Error loading messages");
    }
});

// ================================
// ✅ START SERVER + WebSocket
// ================================
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log(`✅ SERVER running at http://localhost:${PORT}`);
});

// Gắn WebSocket
WS(server, pool);
