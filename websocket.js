import { WebSocketServer } from "ws";
import cookie from "cookie";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";

export const WS = (server, pool) => {
    const wss = new WebSocketServer({ server });

    const userSockets = new Map(); // user_id => Set<WebSocket>
    const wsInfo = new Map();      // ws => user_id

    console.log("✅ WebSocket server started");

    // ======================================================
    // 📡 Connection
    // ======================================================
    wss.on("connection", async (ws, req) => {
        try {
            // debugMaps();
            // Lấy refresh token từ cookie
            const cookies = cookie.parse(req.headers.cookie || "");
            const refreshToken = cookies.refreshToken;
            console.log('ws refreshToken:', refreshToken);
            //console.log('ws userSockets:', wsInfo.entries());

            if (!refreshToken) {
                ws.send(JSON.stringify({ error: "Missing refresh token" }));
                ws.close();
                return;
            }

            // ✅ Xác thực refresh token
            let payload;
            try {
                payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
            } catch {
                ws.send(JSON.stringify({ error: "Invalid or expired refresh token" }));
                ws.close();
                return;
            }
            console.log('payload:', payload, process.env.REFRESH_TOKEN_SECRET);

            const userId = payload.sub;
            //console.log('payload.sub userId:', userId)

            // Lấy thông tin user từ DB
            const r = await pool.query(
                "SELECT id, name, email FROM users WHERE id=$1",
                [userId]
            );

            console.log('user:', r.rows[0], userId);

            if (r.rows.length === 0) {
                ws.send(JSON.stringify({ error: "User not found" }));
                ws.close();
                return;
            }

            const user = r.rows[0];
            console.log('user:', user);

            // Ghi nhận kết nối
            if (!userSockets.has(userId)) userSockets.set(userId, new Set());
            userSockets.get(userId).add(ws);
            wsInfo.set(ws, userId);

            console.log(`✅ ${user.name} (${user.id}) connected (${userSockets.get(userId).size} socket)`);

            // Gửi xác nhận
            ws.send(JSON.stringify({
                type: "welcome",
                user: { id: user.id, name: user.name, email: user.email },
                message: "👋 Connected via WebSocket with refreshToken",
            }));

            broadcastUserList();

            // ======================================================
            // 📨 Nhận message
            // ======================================================
            ws.on("message", async (raw) => {
                try {
                    const data = JSON.parse(raw.toString());
                    if (data.type === "chat") {
                        const { to, message } = data;

                        // Lưu DB
                        await pool.query(
                            `INSERT INTO messages (id, sender_id, receiver_id, content)
               VALUES ($1, $2, $3, $4)`,
                            [uuidv7(), user.id, to === "all" ? null : to, message]
                        );

                        if (to === "all") {
                            // broadcast tới tất cả
                            for (const [uid, sockets] of userSockets.entries()) {
                                sockets.forEach((sock) => {
                                    if (sock.readyState === sock.OPEN) {
                                        sock.send(JSON.stringify({
                                            type: "chat",
                                            from: user.name,
                                            to: "all",
                                            message,
                                        }));
                                    }
                                });
                            }
                        } else {
                            // gửi riêng tới user cụ thể
                            sendToUser(to, {
                                type: "chat",
                                from: user.name,
                                to,
                                message,
                            });

                            // gửi lại cho chính sender
                            sendToUser(user.id, {
                                type: "chat",
                                from: user.name,
                                to,
                                message,
                            });
                        }
                    }
                } catch (err) {
                    console.error("❌ WS message error:", err);
                }
            });

            // ======================================================
            // 📴 Ngắt kết nối
            // ======================================================
            ws.on("close", () => {
                const uid = wsInfo.get(ws);
                if (uid) {
                    userSockets.get(uid)?.delete(ws);
                    if (userSockets.get(uid)?.size === 0) {
                        userSockets.delete(uid);
                    }
                    wsInfo.delete(ws);
                    broadcastUserList();
                    console.log(`❌ ${user.name} disconnected (${userSockets.get(uid)?.size || 0} sockets left)`);
                }
            });

        } catch (err) {
            console.error("❌ WS connection error:", err);
            ws.close();
            //debugMaps();
        }
    });

    // ======================================================
    // 📢 Broadcast danh sách user online
    // ======================================================
    function broadcastUserList() {
        const userList = [...userSockets.keys()];
        const payload = JSON.stringify({ type: "users", users: userList });
        for (const sockets of userSockets.values()) {
            sockets.forEach((ws) => {
                if (ws.readyState === ws.OPEN) ws.send(payload);
            });
        }
    }

    // ======================================================
    // 🚀 Gửi tin đến user cụ thể
    // ======================================================
    function sendToUser(userId, payload) {
        const sockets = userSockets.get(userId);
        if (!sockets) return;
        sockets.forEach((ws) => {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
        });
    }

    function debugMaps() {
        console.log('--- WebSocket Maps ---', new Date().toISOString());
        console.log('userSockets:', userSockets.size);
        for (const [userId, sockets] of userSockets) {
            console.log(`  ${userId} → ${sockets.size} socket(s)`);
        }

        console.log('wsInfo:', wsInfo.size);
        for (const [ws, userId] of wsInfo) {
            console.log(`  ws ${ws._socket?.remoteAddress || 'unknown'} → ${userId}`);
        }
        console.log('-----------------------');
    }

    return { wss, userSockets, sendToUser };
};
