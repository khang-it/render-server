// server-websocket.js
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";

export const WS = (server, pool) => {
    const wss = new WebSocketServer({ server });

    // userId => { user, sockets: Set<WebSocket> }
    const userSockets = new Map();
    // ws => userId
    const wsInfo = new Map();

    console.log("✅ WebSocket server started");

    wss.on("connection", (ws, req) => {
        const ip = req.socket.remoteAddress;
        const port = req.socket.remotePort;

        //console.log('req:', req)
        debugMaps();

        ws.isAuth = false;     // 🔥 client chưa authenticate
        ws.user = null;

        /* ======================================================
           📩 RECEIVE MESSAGE
        ====================================================== */
        ws.on("message", async (raw) => {
            let data;
            try {
                data = JSON.parse(raw.toString());
            } catch (err) {
                console.warn("⚠️ Invalid WS message:", raw.toString());
                return;
            }

            /* ================================================
               1) AUTH MESSAGE
            ================================================= */
            if (data.type === "auth") {
                const token = data.token;
                //console.log('ok:', data);

                if (!token) {
                    ws.send(JSON.stringify({ type: "auth_error", message: "Missing access token" }));
                    ws.close();
                    return;
                }

                let payload;
                try {
                    payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
                } catch (err) {
                    ws.send(JSON.stringify({ type: "auth_error", message: "Invalid or expired token" }));
                    ws.close();
                    return;
                }

                const userId = payload.sub;

                // Lấy user từ DB
                const r = await pool.query(
                    `SELECT id, name, email FROM users WHERE id = $1`,
                    [userId]
                );

                if (r.rows.length === 0) {
                    ws.send(JSON.stringify({ type: "auth_error", message: "User not found" }));
                    ws.close();
                    return;
                }

                const user = r.rows[0];

                ws.isAuth = true;
                ws.user = user;

                // Map <userId, sockets>
                if (!userSockets.has(userId)) {
                    userSockets.set(userId, { user, sockets: new Set() });
                }
                userSockets.get(userId).sockets.add(ws);
                wsInfo.set(ws, userId);

                console.log(`🟢 ${user.name} authenticated (${userId})`);

                ws.send(JSON.stringify({
                    type: "welcome",
                    user,
                    message: "👋 Authenticated & connected"
                }));

                broadcastUserList();
                return;
            }

            /* ================================================
               2) CHẶN TIN NHẮN KHI CHƯA AUTH
            ================================================= */
            if (!ws.isAuth) {
                ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
                return;
            }

            const user = ws.user;

            /* ================================================
               3) CHAT MESSAGE
            ================================================= */
            if (data.type === "chat") {
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
                    // Gửi tới receiver
                    sendToUser(receiverId, {
                        type: "chat",
                        from: user.name,
                        to: receiverId,
                        message
                    });

                    // Echo sender
                    sendToUser(user.id, {
                        type: "chat",
                        from: user.name,
                        to: receiverId,
                        message
                    });
                }
            }

            // ====================
            // LOAD HISTORY
            // ====================
            if (data.type === "load_messages") {
                const partnerId = Number(data.partnerId);
                const userId = ws.user.id;

                const result = await pool.query(`
            SELECT id, sender_id, receiver_id, content, created_at
            FROM messages
            WHERE
                (sender_id = $1 AND receiver_id = $2)
             OR (sender_id = $2 AND receiver_id = $1)
            ORDER BY created_at DESC, id
            LIMIT 50
        `, [userId, partnerId]);

                const rows = result.rows.map(r => ({
                    id: r.id,
                    from: r.sender_id,
                    to: r.receiver_id,
                    message: r.content,
                    created_at: r.created_at,
                    type: 'text'
                }));

                console.log('myId->partnerId:', userId, partnerId, result?.rows?.length);

                ws.send(JSON.stringify({
                    type: "messages",
                    partnerId,
                    rows: rows
                }));

                return;
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

                if (entry && entry.sockets.size === 0) {
                    userSockets.delete(uid);
                }

                wsInfo.delete(ws);
                broadcastUserList();

                console.log(`❌ Disconnected user ${uid}`);
            }
        });
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
