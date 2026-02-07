// ./src/utils/jwt.js
import jwt from "jsonwebtoken";
import crypto from "crypto";

// ========================
// TTL từ ENV
// ========================
export const ACCESS_TOKEN_TTL =
    process.env.ACCESS_TOKEN_TTL || "15m";

export const REFRESH_TOKEN_TTL =
    process.env.REFRESH_TOKEN_TTL || "30d";

// ========================
// HELPERS
// ========================
function ttlToMs(ttl) {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) throw new Error(`Invalid TTL format: ${ttl}`);

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case "s": return value * 1000;
        case "m": return value * 60 * 1000;
        case "h": return value * 60 * 60 * 1000;
        case "d": return value * 24 * 60 * 60 * 1000;
        default:
            throw new Error(`Unsupported TTL unit: ${unit}`);
    }
}

// ========================
// JWT SIGN
// ========================
export function signAccessToken(payload) {
    return jwt.sign(
        payload,
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: ACCESS_TOKEN_TTL }
    );
}

export function signRefreshToken(payload) {
    return jwt.sign(
        payload,
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: REFRESH_TOKEN_TTL }
    );
}

// ========================
// HASH
// ========================
export function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token.trim())
        .digest("hex");
}

// ========================
// SET COOKIE
// ========================
export function setRefreshCookie(res, token) {
    const isHTTPS = true;

    res.cookie("refreshToken", token, {
        httpOnly: true,
        secure: isHTTPS,
        sameSite: isHTTPS ? "None" : "Lax",
        maxAge: ttlToMs(REFRESH_TOKEN_TTL),
        path: "/",
    });
}

// ========================
// CLEAR COOKIE
// ========================
export function clearRefreshToken(res) {
    const isHTTPS = true;

    res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: isHTTPS,
        sameSite: isHTTPS ? "None" : "Lax",
        path: "/",
    });
}
