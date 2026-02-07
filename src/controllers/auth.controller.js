import jwt from "jsonwebtoken";
import {
    findUserByEmail,
    findUserById,
    verifyPassword,
    revokeRefreshToken,
    saveRefreshToken,
    verifyRefreshToken,

} from "#services/auth.service.js";

import {
    signAccessToken,
    signRefreshToken,
    hashToken,
    setRefreshCookie,
    clearRefreshToken,
} from "#utils/jwt.js";


// =====================
// LOGIN
// =====================
export async function login(req, res) {
    const { email, password } = req.body;

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await verifyPassword(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const accessToken = signAccessToken({ sub: user.id });
    const refreshToken = signRefreshToken({ sub: user.id });

    await saveRefreshToken({
        userId: user.id,
        token: refreshToken,
        ua: req.headers["user-agent"],
        ip: req.socket.remoteAddress
    });

    //console.log('login refresh tk:', refreshToken, hashToken(refreshToken))
    setRefreshCookie(res, refreshToken);

    res.json({
        accessToken,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
            provider: user.provider
        }
    });
}


// =====================
// LOGOUT
// =====================
export async function logout(req, res) {

    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
        await revokeRefreshToken(refreshToken);
    }

    clearRefreshToken(res);

    res.json({ ok: true });
}


export async function getMe(req, res) {
    const h = req.headers.authorization || "";
    const [, token] = h.split(" ");

    console.log('token3:', token)
    if (!token) return res.status(401).json({ user: null });

    try {
        const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        const user = await findUserById(payload.sub);
        res.json({ user });
    } catch {
        res.status(401).json({ user: null });
    }
}


export async function refresh(req, res) {

    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken)
        return res.status(401).json({ error: "Missing refresh token" });

    const valid = await verifyRefreshToken(refreshToken);
    if (!valid)
        return res.status(401).json({ error: "Invalid refresh token" });

    const user = await findUserById(valid.userId);

    const newAccess = signAccessToken({ sub: user.id });

    res.json({ accessToken: newAccess });
}


