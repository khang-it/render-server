import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import pkg from "pg";

const { Pool } = pkg;

let poolConfig = {
    connectionString: process.env.DATABASE_URL,
};

// Nếu DATABASE_URL có sslmode=require (cloud Aiven/Render)
// thì bỏ query param đó và verify bằng CA cert
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")) {
    poolConfig = {
        connectionString: process.env.DATABASE_URL.replace("?sslmode=require", ""),
        ssl: {
            rejectUnauthorized: true,
            ca: [fs.readFileSync("./certs/ca.pem").toString()]
        },
        max: 10,                // tối đa 10 connection
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        keepAlive: true
    };
}



const pool = new Pool(poolConfig);

pool.on("error", (err) => {
    console.error("🔥 Unexpected PG Pool Error:", err);
});

export default pool;
