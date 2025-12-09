// server-websocket.js
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";

export const WS = (server, pool) => {
    const wss = new WebSocketServer({ server });

    const conversationMembers = new Map();

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

                // console.log(`🟢 ${user.name} authenticated (${userId})`);

                ws.send(JSON.stringify({
                    type: "welcome",
                    user,
                    message: "👋 Authenticated & connected"
                }));

                await sendRecentContacts(ws);

                await loadUserConversations(userId);

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
                const { conversationId, from, message } = data;
                const fromId = user.id || from;
                //const receiverId = '';

                // Save DB
                const msgSaved = await saveMessage(fromId, conversationId, message);

                // Cập nhật danh sách recent contacts cho cả người gửi và người nhận
                //sendRecentContactsToUser(user.id);
                //sendRecentContactsToUser(receiverId);
                console.log('msgSaved:', msgSaved)
                const content = {
                    type: "chat",
                    payload: {
                        id: msgSaved.id,
                        type: 'text',
                        from: user.id,
                        conversationId: conversationId,
                        message: msgSaved.content,
                        created_at: msgSaved.created_at
                    }
                };

                // Gửi tới receiver
                //sendToUser(receiverId, content);

                // Echo sender
                //sendToUser(user.id, content);

                sendToConversation(conversationId, content);

            }

            if (data.type === "reaction") {
                const { messageId, reaction } = data;
                console.log('reaction-> messageId, reaction:', messageId, reaction);

                // ✅ append emoji vào json array
                const result = await pool.query(`
                    UPDATE messages
                    SET reactions = reactions || jsonb_build_array($2::text)
                    WHERE id = $1
                    RETURNING *
                `, [messageId, reaction]);

                if (result.rowCount === 0) {
                    console.warn('Message not found for reaction', messageId);
                    return;
                }

                const msg = result.rows[0];

                console.log('msg:', msg)
                const conversationId = msg.conversation_id;

                const payload = {
                    type: "reaction_update",
                    messageId,
                    conversationId: conversationId,
                    reactions: msg.reactions   // <-- array đầy đủ
                };

                // sendToUser(msg.sender_id, payload);
                // sendToUser(msg.receiver_id, payload);

                sendToConversation(conversationId, payload)

                return;
            }


            // ====================
            // LOAD HISTORY
            // ====================
            if (data.type === "load_messages") {
                const conversationId = data.conversationId; //conversation_id
                const userId = ws.user.id;

                const result = await pool.query(`
            SELECT id, sender_id,  content, created_at, reactions, type
            FROM messages
            WHERE conversation_id = $1
           ORDER BY created_at DESC, id DESC
            LIMIT 50
        `, [conversationId]);

                const rows = result.rows.map(r => ({
                    id: r.id,
                    from: r.sender_id,
                    // to: r.receiver_id,
                    message: r.content,
                    created_at: r.created_at,
                    reactions: r.reactions,
                    type: r.type
                }));
                //console.log('myId->partnerId:', userId, partnerId, result?.rows?.length);

                ws.send(JSON.stringify({
                    type: "messages",
                    conversationId,
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
            type: "conversions",
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
    async function saveMessage(senderId, conversationId, content) {
        const id = uuidv7();
        const sql = `
        INSERT INTO messages (id, sender_id, conversation_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id, sender_id, conversation_id, content, created_at
    `;
        const result = await pool.query(sql, [id, senderId, conversationId, content]);

        return result.rows[0];
    }

    async function sendRecentContacts(ws) {
        if (!ws.isAuth || !ws.user) return;
        const userId = ws.user.id;
        console.log('userId:', userId)

        try {
            const result = await pool.query(`
                WITH last_messages AS (
                    SELECT DISTINCT ON (m.conversation_id)
                        m.conversation_id,
                        m.content,
                        m.created_at
                    FROM messages m
                    ORDER BY m.conversation_id, m.created_at DESC
                )
                SELECT
                    c.id AS conversation_id,
                    c.type,
                    c.name AS group_name,
                    c.avatar AS group_avatar,

                    lm.created_at AS last_message_at,
                    lm.content AS last_message_preview,

                    u.id AS other_user_id,
                    u.name AS other_user_name,
                    u.email AS other_user_email,
                    u.avatar AS other_user_avatar
                FROM conversation_members cm
                JOIN conversations c ON c.id = cm.conversation_id

                LEFT JOIN last_messages lm ON lm.conversation_id = c.id

                -- chỉ join user còn lại nếu là direct
                LEFT JOIN conversation_members cm2
                    ON cm2.conversation_id = c.id
                AND cm2.user_id != $1

                LEFT JOIN users u
                    ON u.id = cm2.user_id

                WHERE cm.user_id = $1
                ORDER BY lm.created_at DESC NULLS LAST
                LIMIT 50;
        `, [userId]);

            const conversations = result.rows.map(r => {
                if (r.type === 'direct') {
                    return {
                        conversationId: r.conversation_id,
                        type: 'direct',
                        title: r.other_user_name,
                        avatar: r.other_user_avatar,
                        userId: r.other_user_id,
                        lastMessageAt: r.last_message_at,
                        lastMessagePreview: r.last_message_preview || '',
                        online: userSockets.has(r.other_user_id)
                    };
                }

                // group
                return {
                    conversationId: r.conversation_id,
                    type: 'group',
                    title: r.group_name,
                    avatar: r.group_avatar,
                    lastMessageAt: r.last_message_at,
                    lastMessagePreview: r.last_message_preview || '',
                    online: false
                };
            });

            console.log('conversations:', conversations.length)

            ws.send(JSON.stringify({
                type: 'recent_contacts', // giữ tên cũ cho FE
                conversations
            }));

        } catch (err) {
            console.error('Error loading recent conversations:', err);
        }
    }

    async function loadUserConversations(userId) {
        const r = await pool.query(`
        SELECT conversation_id
        FROM conversation_members
        WHERE user_id = $1
    `, [userId]);

        for (const row of r.rows) {
            if (!conversationMembers.has(row.conversation_id)) {
                conversationMembers.set(row.conversation_id, new Set());
            }
            conversationMembers.get(row.conversation_id).add(userId);
        }
    }

    // Hàm phụ: gửi cho tất cả socket của 1 user
    function sendRecentContactsToUser(userId) {
        const entry = userSockets.get(userId);
        if (!entry) return;
        entry.sockets.forEach(ws => sendRecentContacts(ws));
    }

    function sendToConversation(conversationId, payload) {
        const members = conversationMembers.get(conversationId);
        console.log('members:', members)
        if (!members) return;

        for (const userId of members) {
            sendToUser(userId, payload);
        }
    }


    return { wss, userSockets, sendToUser };

};
