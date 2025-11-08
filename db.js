import fs from "fs";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
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
            ca: [fs.readFileSync("./ca.pem").toString()]
        }
    };
}

const pool = new Pool(poolConfig);

export default pool;
