import { WebSocketServer } from "ws";
import { v7 as uuidv7 } from "uuid";

export const WS = (server, pool) => {
    const wss = new WebSocketServer({ server });
    const clients = new Map(); // ws => { id, name }

    function broadcastUserList() {
        const userList = [...clients.values()].map((u) => ({
            id: u.id,
            name: u.name,
        }));
        wss.clients.forEach((client) => {
            if (client.readyState === client.OPEN) {
                client.send(JSON.stringify({ type: "users", users: userList }));
            }
        });
    }

    wss.on("connection", async (ws) => {
        // Tạo UUID cho user
        const userId = uuidv7();
        const username = `User-${userId.slice(0, 8)}`; // ví dụ: User-1a2b3c4d

        clients.set(ws, { id: userId, name: username });

        console.log(`✅ ${username} connected`, userId);
        ws.send(JSON.stringify({ type: "welcome", id: userId, name: username, message: '👋 Welcome! ' }));

        broadcastUserList();

        ws.on("message", async (raw) => {
            try {
                const data = JSON.parse(raw.toString());
                const sender = clients.get(ws);

                if (data.type === "chat") {
                    const { to, message } = data;

                    // Lưu DB
                    await pool.query(
                        `INSERT INTO messages (id, sender_id, receiver_id, content)
   VALUES ($1, $2, $3, $4)`,
                        [uuidv7(), sender.id, to === "all" ? null : to, message]
                    );

                    if (to === "all") {
                        // broadcast tới tất cả
                        wss.clients.forEach((client) => {
                            if (client.readyState === client.OPEN) {
                                client.send(
                                    JSON.stringify({
                                        type: "chat",
                                        from: sender.name,
                                        to: "all",
                                        message,
                                    })
                                );
                            }
                        });
                    } else {
                        // private message
                        const receiver = [...clients.entries()].find(([_, u]) => u.id == to);
                        if (receiver) {
                            const [targetWs, targetUser] = receiver;

                            // gửi cho người nhận
                            targetWs.send(
                                JSON.stringify({
                                    type: "chat",
                                    from: sender.name,
                                    to: targetUser.id,
                                    message,
                                })
                            );

                            // gửi lại cho chính sender
                            ws.send(
                                JSON.stringify({
                                    type: "chat",
                                    from: sender.name,
                                    to,
                                    message,
                                })
                            );
                        }
                    }
                }
            } catch (err) {
                console.error("❌ WS message error:", err);
            }
        });

        ws.on("close", () => {
            const user = clients.get(ws);
            clients.delete(ws);
            broadcastUserList();
            console.log(`❌ ${user?.name} disconnected`);
        });
    });
};
