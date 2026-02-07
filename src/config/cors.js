const allowedOrigins = [
    "http://localhost:12345",
    "https://localhost:12345",
    "http://localhost:4000",
    "https://localhost:4443",
    "https://wh.io.vn",
    "https://render-server-ezuf.onrender.com"
];

export default {
    origin(origin, cb) {
        if (!origin || allowedOrigins.includes(origin)) {
            cb(null, true);
        } else {
            cb(new Error("CORS blocked"));
        }
    },
    credentials: true
};
