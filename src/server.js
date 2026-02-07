import http from "http";
import https from "https";
import fs from "fs";
import app from "./app.js";
import pool from "#db";
import { WS } from "#src/websocket.js";

const HTTP_PORT = process.env.HTTP_PORT || 4000;
const HTTPS_PORT = process.env.HTTPS_PORT || 4443;

const sslOptions = {
    key: fs.readFileSync("./keys/localhost-key.pem"),
    cert: fs.readFileSync("./keys/localhost.pem"),
};

const httpServer = http.createServer(app);
const httpsServer = https.createServer(sslOptions, app);

WS(httpServer, pool);

httpServer.listen(HTTP_PORT, () => {
    console.log(`🌐 HTTP http://localhost:${HTTP_PORT}`);
});

httpsServer.listen(HTTPS_PORT, () => {
    console.log(`🔐 HTTPS https://localhost:${HTTPS_PORT}`);
});
