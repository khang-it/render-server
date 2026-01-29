// middleware/requestLogger.js
export const requestLogger = (req, res, next) => {
    const protocol = req.protocol; // http hoặc https
    const host = req.hostname; // domain (ví dụ: localhost, wh.io.vn)
    const port = req.socket.localPort; // cổng server đang chạy
    const originalUrl = req.originalUrl; // đường dẫn
    const method = req.method; // GET, POST, PUT, DELETE
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.get('User-Agent');
    const cookies = req.cookies;
    const body = req.body;
    const query = req.query;

    // 🕒 Thời gian log
    const time = new Date().toISOString();

    // Ghi log chi tiết
    console.log(`
================= 🧭 REQUEST LOG =================
🕒  Time:        ${time}
📡  Protocol:    ${protocol}
🌐  Domain:      ${host}
🔌  Port:        ${port}
➡️  Method:      ${method}
📄  Path:        ${originalUrl}
💻  IP:          ${ip}
🧠  User-Agent:  ${userAgent}
🍪  Cookies:     ${JSON.stringify(cookies)}
🔍  Query:       ${JSON.stringify(query)}
📦  Body:        ${JSON.stringify(body)}
==================================================
    `);

    // Tiếp tục sang middleware tiếp theo
    next();
};
