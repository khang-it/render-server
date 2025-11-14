import { WebSocketServer } from "ws";
import cookie from "cookie";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";

export const WS = (server, pool) => {
    const wss = new WebSocketServer({ server });

    const userSockets = new Map(); // user_id => Set<WebSocket>
    const wsInfo = new Map();      // ws => user_id

    console.log("✅ WebSocket server started");

    wss.on("connection", async (ws, req) => {
        const ip = req.socket.remoteAddress;
        const port = req.socket.remotePort;

        console.log(`🔗 WS CONNECT from ${ip}:${port}`);
        debugMaps();

        try {
            const cookies = cookie.parse(req.headers.cookie || "");
            const refreshToken = cookies.refreshToken;

            if (!refreshToken) {
                ws.send(JSON.stringify({ error: "Missing refresh token" }));
                ws.close();
                return;
            }

            let payload;
            try {
                payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
            } catch {
                ws.send(JSON.stringify({ error: "Invalid or expired refresh token" }));
                ws.close();
                return;
            }

            const userId = payload.sub;

            const r = await pool.query(
                `SELECT id, name, email FROM users WHERE id = $1`,
                [userId]
            );

            if (r.rows.length === 0) {
                ws.send(JSON.stringify({ error: "User not found" }));
                ws.close();
                return;
            }

            const user = r.rows[0];

            // Lưu socket
            if (!userSockets.has(userId)) userSockets.set(userId, new Set());
            userSockets.get(userId).add(ws);
            wsInfo.set(ws, userId);

            console.log(`✅ ${user.name} (${user.id}) connected (${userSockets.get(userId).size} socket)`);

            ws.send(JSON.stringify({
                type: "welcome",
                user,
                message: "👋 Connected"
            }));

            broadcastUserList();

            // ======================================================
            // 📩 Message handler
            // ======================================================
            ws.on("message", async (raw) => {
                try {
                    const data = JSON.parse(raw.toString());
                    if (data.type !== "chat") return;

                    const { to, message } = data;

                    // CHỖ FIX SQL: receiver_id luôn là số nguyên → không được NULL
                    const receiverId = to === "all" ? 0 : Number(to);

                    await pool.query(
                        `INSERT INTO messages (id, sender_id, receiver_id, content)
                         VALUES ($1, $2, $3, $4)`,
                        [uuidv7(), user.id, receiverId, message]
                    );

                    if (to === "all") {
                        // broadcast global
                        for (const [uid, sockets] of userSockets.entries()) {
                            sockets.forEach(sock => {
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
                        // gửi đến receiver
                        sendToUser(receiverId, {
                            type: "chat",
                            from: user.name,
                            to: receiverId,
                            message
                        });

                        // gửi lại cho chính sender
                        sendToUser(user.id, {
                            type: "chat",
                            from: user.name,
                            to: receiverId,
                            message
                        });
                    }

                } catch (err) {
                    console.error("❌ WS message error:", err);
                }
            });

            // ======================================================
            // ❌ Disconnect
            // ======================================================
            ws.on("close", () => {
                const uid = wsInfo.get(ws);

                if (uid) {
                    userSockets.get(uid)?.delete(ws);
                    if (userSockets.get(uid)?.size === 0) userSockets.delete(uid);
                    wsInfo.delete(ws);

                    broadcastUserList();

                    console.log(`❌ ${user.name} disconnected (${userSockets.get(uid)?.size || 0} sockets left)`);
                }
            });

        } catch (err) {
            console.error("❌ WS ERROR:", err);
            ws.close();
            debugMaps();
        }
    });

    // ======================================================
    // 👥 Broadcast user list
    // ======================================================
    function broadcastUserList() {
        const payload = JSON.stringify({
            type: "users",
            users: [...userSockets.keys()]
        });

        for (const sockets of userSockets.values()) {
            sockets.forEach(ws => {
                if (ws.readyState === ws.OPEN) ws.send(payload);
            });
        }
    }

    // ======================================================
    // 📤 Send to specific user
    // ======================================================
    function sendToUser(userId, payload) {
        const sockets = userSockets.get(userId);
        if (!sockets) return;
        sockets.forEach(ws => {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
        });
    }

    // ======================================================
    // 🔍 Debug maps
    // ======================================================
    function debugMaps() {
        console.log("\n========== 🔍 WS DEBUG MAPS ==========");
        console.log(`👥 Total users connected: ${userSockets.size}`);

        for (const [userId, sockets] of userSockets) {
            console.log(`  • User ${userId}: ${sockets.size} socket(s)`);
            for (const ws of sockets) {
                const s = ws._socket;
                console.log(`      - Socket ${s.remoteAddress}:${s.remotePort} | readyState=${ws.readyState}`);
            }
        }

        console.log(`\n🔌 Total sockets: ${wsInfo.size}`);
        for (const [ws, userId] of wsInfo) {
            const s = ws._socket;
            console.log(`  • Socket ${s.remoteAddress}:${s.remotePort} → User ${userId}`);
        }
        console.log("======================================\n");
    }

    return { wss, userSockets, sendToUser };
};
