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
                console.log('auth:', data);

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
                //console.log('payload:', payload);

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

                await sendRecentContacts(ws);

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
                const msgSaved = await saveMessage(user.id, receiverId, message);

                // Cập nhật danh sách recent contacts cho cả người gửi và người nhận
                sendRecentContactsToUser(user.id);
                sendRecentContactsToUser(receiverId);
                console.log('msgSaved:', msgSaved)
                const content = {
                    type: "chat",
                    payload: {
                        id: msgSaved.id,
                        type: 'text',
                        from: user.id,
                        to: receiverId,
                        message: msgSaved.content,
                        created_at: msgSaved.created_at
                    }
                };

                // Gửi tới receiver
                sendToUser(receiverId, content);

                // Echo sender
                sendToUser(user.id, content);

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
           ORDER BY created_at DESC, id DESC
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

        //console.log(`\n🔌 Total sockets: ${wsInfo.size}`);
        for (const [ws, uid] of wsInfo) {
            const s = ws._socket;
            //console.log(`  • Socket ${s.remoteAddress}:${s.remotePort} → User ${uid}`);
        }
        //console.log("======================================\n");
    }

    // save DB
    async function saveMessage(senderId, receiverId, content) {
        const id = uuidv7();
        const sql = `
        INSERT INTO messages (id, sender_id, receiver_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id, sender_id, receiver_id, content, created_at
    `;

        const result = await pool.query(sql, [id, senderId, receiverId, content]);

        return result.rows[0];
    }

    // Hàm chính: gửi danh sách 50 người chat gần nhất cho 1 ws
    async function sendRecentContacts(ws) {
        if (!ws.isAuth || !ws.user) return;
        const userId = ws.user.id;
        //console.log('user connect:', ws.user)

        try {
            const result = await pool.query(`
            SELECT 
                u.id,
                u.name,
                u.email,
                lm.last_message_at,
                lm.content AS last_message_preview
            FROM users u
            LEFT JOIN LATERAL (
                SELECT 
                    m.created_at AS last_message_at,
                    m.content
                FROM messages m
                WHERE (m.sender_id = u.id AND m.receiver_id = $1)
                OR (m.sender_id = $1 AND m.receiver_id = u.id)
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1
            ) lm ON true
            WHERE u.id != $1
            ORDER BY 
                lm.last_message_at DESC NULLS LAST,  
                u.name ASC                            
            LIMIT 50;                                 
        `, [userId]);

            //console.log('list user:', result.rows)

            const contacts = result.rows.map(r => ({
                id: r.id,
                name: r.name,
                email: r.email,
                lastMessageAt: r.last_message_at,
                lastMessagePreview: r.last_message_preview || "",
                online: userSockets.has(r.id)  // <--- CHECK ONLINE
            }));


            ws.send(JSON.stringify({ type: "recent_contacts", contacts }));
        } catch (err) {
            console.error("Error loading recent contacts:", err);
        }
    }

    // Hàm phụ: gửi cho tất cả socket của 1 user
    function sendRecentContactsToUser(userId) {
        const entry = userSockets.get(userId);
        if (!entry) return;
        entry.sockets.forEach(ws => sendRecentContacts(ws));
    }

    return { wss, userSockets, sendToUser };

};
