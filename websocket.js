// server-websocket.js
import { WebSocketServer } from "ws";
import cookie from "cookie";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";

export const WS = (server, pool) => {
    const wss = new WebSocketServer({ server });

    // userId => { user, sockets: Set<WebSocket> }
    const userSockets = new Map();
    // ws => userId
    const wsInfo = new Map();

    console.log("✅ WebSocket server started");

    wss.on("connection", async (ws, req) => {
        const ip = req.socket.remoteAddress;
        const port = req.socket.remotePort;
        console.log(`🔗 WS CONNECT from ${ip}:${port}`);
        debugMaps();

        try {
            /* ---------------------------
               1) Lấy refreshToken từ cookie
            ----------------------------- */
            const cookies = cookie.parse(req.headers.cookie || "");
            const refreshToken = cookies.refreshToken;

            if (!refreshToken) {
                ws.send(JSON.stringify({ error: "Missing refresh token" }));
                ws.close();
                return;
            }

            /* ---------------------------
               2) Xác thực Refresh Token
            ----------------------------- */
            let payload;
            try {
                payload = jwt.verify(
                    refreshToken,
                    process.env.REFRESH_TOKEN_SECRET
                );
            } catch {
                ws.send(JSON.stringify({ error: "Invalid or expired refresh token" }));
                ws.close();
                return;
            }

            const userId = payload.sub;

            /* ---------------------------
               3) Lấy thông tin user từ DB
            ----------------------------- */
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

            /* ---------------------------
               4) Lưu socket vào Map
            ----------------------------- */
            if (!userSockets.has(userId)) {
                userSockets.set(userId, {
                    user,
                    sockets: new Set()
                });
            }

            userSockets.get(userId).sockets.add(ws);
            wsInfo.set(ws, userId);

            console.log(`✅ ${user.name} (${user.id}) connected (${userSockets.get(userId).sockets.size} sockets)`);

            /* ---------------------------
               5) Gửi welcome
            ----------------------------- */
            ws.send(JSON.stringify({
                type: "welcome",
                user,
                message: "👋 Connected"
            }));

            // Broadcast danh sách user đang online
            broadcastUserList();

            /* ======================================================
               📩 HANDLE INCOMING MESSAGE
            ====================================================== */
            ws.on("message", async (raw) => {
                try {
                    const data = JSON.parse(raw.toString());
                    if (data.type !== "chat") return;

                    const { to, message } = data;

                    const receiverId = to === "all" ? 0 : Number(to);

                    // Save DB
                    await pool.query(
                        `INSERT INTO messages (id, sender_id, receiver_id, content)
                         VALUES ($1, $2, $3, $4)`,
                        [uuidv7(), user.id, receiverId, message]
                    );

                    if (to === "all") {
                        // Broadcast to all
                        for (const { sockets } of userSockets.values()) {
                            sockets.forEach(sock => {
                                if (sock.readyState === sock.OPEN) {
                                    sock.send(JSON.stringify({
                                        type: "chat",
                                        from: user.name,
                                        to: "all",
                                        message
                                    }));
                                }
                            });
                        }
                    } else {
                        // Send to receiver
                        sendToUser(receiverId, {
                            type: "chat",
                            from: user.name,
                            to: receiverId,
                            message
                        });

                        // Echo back to sender
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

            /* ======================================================
               ❌ DISCONNECT
            ====================================================== */
            ws.on("close", () => {
                const uid = wsInfo.get(ws);

                if (uid) {
                    const entry = userSockets.get(uid);
                    entry?.sockets.delete(ws);

                    if (entry?.sockets.size === 0) {
                        userSockets.delete(uid);
                    }

                    wsInfo.delete(ws);
                    broadcastUserList();

                    console.log(`❌ ${user.name} disconnected (${entry?.sockets.size || 0} sockets left)`);
                }
            });

        } catch (err) {
            console.error("❌ WS ERROR:", err);
            ws.close();
            debugMaps();
        }
    });

    /* ======================================================
       👥 BROADCAST USER LIST
    ====================================================== */
    function broadcastUserList() {
        const usersOnline = [];

        for (const { user } of userSockets.values()) {
            usersOnline.push({
                id: user.id,
                name: user.name,
                email: user.email
            });
        }

        const payload = JSON.stringify({
            type: "users",
            users: usersOnline
        });

        for (const { sockets } of userSockets.values()) {
            sockets.forEach(ws => {
                if (ws.readyState === ws.OPEN) ws.send(payload);
            });
        }
    }

    /* ======================================================
       📤 SEND MESSAGE TO SPECIFIC USER
    ====================================================== */
    function sendToUser(userId, payload) {
        const entry = userSockets.get(userId);
        if (!entry) return;

        entry.sockets.forEach(ws => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(payload));
            }
        });
    }

    /* ======================================================
       🔍 DEBUG MAPS
    ====================================================== */
    function debugMaps() {
        console.log("\n========== 🔍 WS DEBUG MAPS ==========");
        console.log(`👥 Total users connected: ${userSockets.size}`);

        for (const [uid, entry] of userSockets.entries()) {
            console.log(`  • User ${uid}: ${entry.sockets.size} sockets`);
            for (const ws of entry.sockets) {
                const s = ws._socket;
                console.log(`      - Socket ${s.remoteAddress}:${s.remotePort} | readyState=${ws.readyState}`);
            }
        }

        console.log(`\n🔌 Total sockets: ${wsInfo.size}`);
        for (const [ws, uid] of wsInfo) {
            const s = ws._socket;
            console.log(`  • Socket ${s.remoteAddress}:${s.remotePort} → User ${uid}`);
        }
        console.log("======================================\n");
    }

    return { wss, userSockets, sendToUser };
};
