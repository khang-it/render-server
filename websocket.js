// server-websocket.js
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { v7 as uuid } from "uuid";

export const WS = (server, pool) => {
    const wss = new WebSocketServer({ server });

    const conversationMembers = new Map();

    const callSessions = new Map();

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
                //console.log('auth:', data);

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
                const { conversationId, from, message, msgType = 'text', replyTo } = data;
                const fromId = user.id || from;
                //const receiverId = '';

                // Save DB
                const msgSaved = await saveMessage(fromId, conversationId, message, replyTo, msgType);

                const replyToJson = await findMessageReplyTo(
                    msgSaved.reply_to_message_id
                );
                console.log('msgSaved:', msgSaved)
                const content = {
                    type: "chat",
                    payload: {
                        id: msgSaved.id,
                        type: msgSaved.type,
                        from: user.id,
                        conversationId: conversationId,
                        message: msgSaved.content,
                        created_at: msgSaved.created_at,
                        reply_to: replyToJson
                    }
                };

                sendToConversation(conversationId, content);

                // 5️⃣ CẬP NHẬT RECENT CONTACTS
                const members = conversationMembers.get(conversationId);
                if (members) {
                    for (const uid of members) {
                        sendRecentContactsToUser(uid);
                    }
                }

            }

            /* ================================================
                4) SHARE MESSAGE
            ================================================= */
            if (data.type === "message_share") {
                const {
                    fromConversationId,
                    targetConversationIds,
                    // messageIds,
                    note = '',
                    messages,
                } = data;

                //console.log('messages:', messages)

                const senderId = ws.user.id;
                for (const toConversationId of targetConversationIds) {
                    //const toConversationId = message?.id || '';

                    for (const msg of messages) {
                        //console.log('msg:', msg);

                        // 1️⃣ GHI LOG
                        //messageIds
                        await saveMessageShare(
                            senderId,
                            fromConversationId,
                            toConversationId,
                            msg.message,
                            note
                        );

                        // 2️⃣ GHI MESSAGE ĐỂ HIỂN THỊ
                        // JSON.stringify({type: 'share',fromConversationId, message: msg.message, note: note}),
                        const msgSaved = await saveMessage(
                            senderId,
                            toConversationId,
                            msg.message,
                            null,
                            msg.type
                        );

                        // 3️⃣ WS PAYLOAD
                        const payload = {
                            type: 'chat',
                            payload: {
                                id: msgSaved.id,
                                type: 'share',
                                from: senderId,
                                conversationId: toConversationId,
                                message: msgSaved.content,
                                created_at: msgSaved.created_at
                            }
                        };

                        // 4️⃣ GỬI TIN
                        sendToConversation(toConversationId, payload);

                        // 5️⃣ CẬP NHẬT RECENT CONTACTS
                        const members = conversationMembers.get(toConversationId);
                        if (members) {
                            for (const uid of members) {
                                sendRecentContactsToUser(uid);
                            }
                        }
                    }
                }
                return;
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

                //console.log('msg:', msg)
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
                const { conversationId, firstMsg } = data;
                const beforeCreatedAt = firstMsg?.created_at ?? null;
                //const beforeId = firstMsg?.id;
                //console.log('firstMsg:', firstMsg)
                const userId = ws.user.id;
                const params = [conversationId, userId];
                let sql = `
                    SELECT 
                        m.id, m.sender_id, m.content, m.created_at, m.reactions, m.type, m.status,
                        json_build_object(
                            'id', r.id,
                            'sender_id', r.sender_id,
                            'content', left(r.content, 120),
                            'type', r.type
                        ) AS reply_to
                    FROM messages m 
                    LEFT JOIN messages r ON r.id = m.reply_to_message_id
                    WHERE m.conversation_id = $1 
                        AND NOT EXISTS (
                            SELECT 1
                            FROM message_deletions d
                            WHERE d.message_id = m.id
                                AND d.user_id = $2
                        )
                `;

                if (beforeCreatedAt) {
                    sql += ` AND m.created_at < $3 `;
                    params.push(beforeCreatedAt);
                }

                sql += `
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT 10
                `;

                //console.log('sql:', sql)

                const result = await pool.query(sql, params);

                //console.log('rows0:', result.rows)

                const rows = result.rows
                    .reverse()
                    .map(r => ({
                        id: r.id,
                        from: r.sender_id,
                        conversationId,
                        message: r.content,
                        created_at: r.created_at,
                        reactions: r.reactions,
                        type: r.type,
                        status: r.status,
                        reply_to: r.reply_to
                    }));

                //console.log('rows:', rows)

                ws.send(JSON.stringify({
                    type: "messages",
                    conversationId,
                    rows
                }));
            }

            if (data.type === "recall") {
                const { messageId } = data;
                const userId = ws.user.id;

                // ✅ Chỉ sender mới được thu hồi
                const result = await pool.query(`
                        UPDATE messages
                        SET status = 1
                        WHERE id = $1 AND sender_id = $2
                        RETURNING conversation_id
                    `, [messageId, userId]);

                if (result.rowCount === 0) {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Không thể thu hồi tin nhắn"
                    }));
                    return;
                }

                const conversationId = result.rows[0].conversation_id;

                // 🔔 Broadcast cho toàn bộ conversation
                sendToConversation(conversationId, {
                    type: "message_recalled",
                    messageId
                });

                // 5️⃣ CẬP NHẬT RECENT CONTACTS
                const members = conversationMembers.get(conversationId);
                if (members) {
                    for (const uid of members) {
                        sendRecentContactsToUser(uid);
                    }
                }

                return;
            }

            if (data.type === "delete") {
                const { messageId } = data;
                const userId = ws.user.id;

                // ⛔ Không cho xoá nếu message đã thu hồi
                await pool.query(`
                    INSERT INTO message_deletions (message_id, user_id)
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING
                `, [messageId, userId]);

                // 🔔 Chỉ gửi lại cho CHÍNH USER
                ws.send(JSON.stringify({
                    type: "message_deleted_self",
                    messageId
                }));

                sendRecentContactsToUser(userId);

                return;
            }

            // ================= CALL JOIN =================
            if (data.type === "join_call") {
                const { conversationId } = data;
                const userId = ws.user.id;
                console.log('join_call:', userId)

                //console.log('join_call conversationId:', conversationId, conversationMembers.has(conversationId))
                //console.log('join_call conversationMembers:', conversationMembers)

                if (!conversationMembers.has(conversationId)) return;

                ws.callRoom = conversationId;

                // thông báo cho người khác trong conversation
                const members = conversationMembers.get(conversationId);

                //console.log('userId:', userId)
                //console.log('members:', members)
                for (const uid of members) {
                    console.log('send call -> uid, userId:', uid, userId)
                    if (uid !== userId) {
                        sendToUser(uid, {
                            type: "call_peer_joined",
                            conversationId,
                            from: userId
                        });
                    }
                }

                return;
            }

            // ================= CALL SIGNAL =================
            if (data.type === "call_signal") {
                const { conversationId, data: signal } = data;
                const userId = ws.user.id;

                console.log('call_signal conversationId:', conversationId)
                console.log('call_signal signal:', signal)

                const members = conversationMembers.get(conversationId);
                if (!members) return;

                for (const uid of members) {
                    if (uid !== userId) {
                        sendToUser(uid, {
                            type: "call_signal",
                            conversationId,
                            from: userId,
                            data: signal
                        });
                    }
                }

                return;
            }

            // ================= CALL INVITE =================
            if (data.type === "call_invite") {
                const { conversationId, callType = "video" } = data;
                const callerId = ws.user.id;
                console.log('call_invite:', callerId)

                const members = conversationMembers.get(conversationId);
                if (!members) return;

                // nếu đã có call session → bỏ qua
                if (callSessions.has(conversationId)) return;

                const timeout = setTimeout(async () => {
                    callSessions.delete(conversationId);

                    const callData = {
                        callType: callType,
                        status: "missed",
                        duration: 0
                    };

                    const msg = await saveCallMessage(conversationId, callerId, null, callData);

                    // ✅ push realtime message
                    sendToConversation(conversationId, {
                        type: "chat",
                        payload: {
                            id: msg.id,
                            from: callerId,
                            conversationId,
                            message: JSON.stringify(callData),
                            created_at: msg.created_at,
                            type: "call"
                        }
                    });

                }, 10000);  //30s


                callSessions.set(conversationId, {
                    callerId,
                    callType,
                    startTime: null,
                    timeout
                });

                // gửi ringing cho người kia
                for (const uid of members) {
                    if (uid !== callerId) {
                        sendToUser(uid, {
                            type: "call_invite",
                            conversationId,
                            from: callerId,
                            callType,
                            fromName: ws.user.name
                        });
                    }
                }

                return;
            }

            // ================= CALL ACCEPT =================
            if (data.type === "call_accept") {
                const { conversationId } = data;
                const userId = ws.user.id;
                console.log('call_accept:', userId)

                const session = callSessions.get(conversationId);
                if (!session) return;

                clearTimeout(session.timeout);
                session.startTime = Date.now();

                const members = conversationMembers.get(conversationId);
                if (!members) return;

                for (const uid of members) {
                    if (uid !== userId) {
                        sendToUser(uid, {
                            type: "call_accept",
                            conversationId,
                            from: userId,
                            callType: session?.callType || 'video'  // video | audio
                        });
                    }
                }

                return;
            }


            // ================= CALL END =================
            if (data.type === "call_end") {
                const { conversationId, message } = data;
                const userId = ws.user.id;

                console.log('call_end:', userId)

                const session = callSessions.get(conversationId);
                if (!session) return;

                const members = conversationMembers.get(conversationId);
                if (!members) return;

                let duration = 0;
                if (session.startTime) {
                    duration = Math.floor((Date.now() - session.startTime) / 1000);
                }

                const callData = {
                    callType: "video",
                    status: duration > 0 ? "ended" : "missed",
                    duration,
                    message: message?.reason,
                    callType: session.callType,   // 👈 video | audio
                };

                // ✅ ghi DB
                const msg = await saveCallMessage(conversationId, session.callerId, userId, callData);
                console.log('saveCallMessage:', msg)
                callSessions.delete(conversationId);

                // ✅ broadcast message realtime
                sendToConversation(conversationId, {
                    type: "chat",
                    payload: {
                        id: msg.id,
                        from: session.callerId,
                        conversationId,
                        message: JSON.stringify(callData),
                        created_at: msg.created_at,
                        type: "call"
                    }
                });

                // thông báo end call cho UI call
                //console.log('members:', members)
                for (const uid of members) {
                    if (uid !== userId) {
                        sendToUser(uid, {
                            type: "call_end",
                            conversationId,
                            from: userId,
                            callType: session.callType,   // 👈 video | audio
                        });
                    }
                }

                return;
            }



            // ================= // CALL JOIN =================

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
    async function saveMessage(senderId, conversationId, content, reply_to_message_id, msgType) {
        const id = uuid();
        const sql = `
        INSERT INTO messages (id, sender_id, conversation_id, content, reply_to_message_id, type)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, sender_id, conversation_id, content, created_at, reply_to_message_id, type
    `;
        const result = await pool.query(sql, [id, senderId, conversationId, content, reply_to_message_id, msgType]);

        return result.rows[0];
    }

    async function saveMessageShare(
        senderId,
        fromConversationId,
        toConversationId,
        message,
        note
    ) {
        const sql = `
        INSERT INTO message_shares
        (sender_id, from_conversation_id, to_conversation_id, message, note)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    `;

        const result = await pool.query(sql, [
            senderId,
            fromConversationId,
            toConversationId,
            message,
            note
        ]);

        return result.rows[0];
    }

    async function getMessagesByIds(ids = []) {
        if (!ids.length) return [];

        const sql = `
        SELECT 
            id,
            sender_id AS from,
            content AS message,
            type,
            created_at
        FROM messages
        WHERE id = ANY($1::uuid[])
        ORDER BY created_at ASC
    `;

        const result = await pool.query(sql, [ids]);
        return result.rows;
    }


    async function findMessageReplyTo(replyToMessageId) {
        if (!replyToMessageId) return null;

        const sql = `
    SELECT json_build_object(
      'id', m.id,
      'sender_id', m.sender_id,
      'content', left(m.content, 120),
      'type', m.type
    ) AS reply_to
    FROM messages m
    WHERE m.id = $1
  `;

        const result = await pool.query(sql, [replyToMessageId]);

        return result.rows[0]?.reply_to ?? null;
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

            //console.log('conversations:', conversations.length)

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
        //console.log('members:', members)
        if (!members) return;

        for (const userId of members) {
            sendToUser(userId, payload);
        }
    }

    async function saveCallMessage(conversationId, fromId, toId, callData) {
        const id = uuid();
        const content = JSON.stringify(callData);

        const result = await pool.query(`
        INSERT INTO messages (id, sender_id, conversation_id, content, type)
        VALUES ($1, $2, $3, $4, 'call')
        RETURNING *
    `, [id, fromId, conversationId, content]);

        return result.rows[0];
    }

    return { wss, userSockets, sendToUser };

};
