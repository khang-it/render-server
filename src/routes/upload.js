import express from "express";
import multer from "multer";
import mime from "mime-types";
import { v7 as uuid } from "uuid";
import path from "path";
import fs from "fs";

import { UPLOAD_ROOT_ABS, UPLOAD_ROOT } from "../config/upload.js";

const router = express.Router();

// ================================
// CONFIG STORAGE
// ================================
const storage = multer.diskStorage({
    destination(req, file, cb) {
        let dir = "files";
        if (file.mimetype.startsWith("image/")) dir = "images";
        else if (file.mimetype.startsWith("video/")) dir = "videos";

        const uploadPath = path.join(UPLOAD_ROOT_ABS, dir);
        fs.mkdirSync(uploadPath, { recursive: true });

        // 🔥 GẮN dir VÀO FILE ĐỂ DÙNG SAU
        file._uploadDir = dir;

        cb(null, uploadPath);
    },

    filename(req, file, cb) {
        const ext = mime.extension(file.mimetype) || "bin";
        const filename = `${uuid()}.${ext}`;

        // 🔥 LƯU filename ĐỂ DÙNG LẠI
        file._filename = filename;

        cb(null, filename);
    }
});

// ================================
// FILE FILTER
// ================================
function fileFilter(req, file, cb) {
    const allowed = [
        "image/",
        "video/",
        "application/pdf",
        "application/zip"
    ];

    const ok = allowed.some(t =>
        file.mimetype.startsWith(t)
    );

    cb(ok ? null : new Error("File type not allowed"), ok);
}

// ================================
// LIMIT
// ================================
const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

// ================================
// ROUTE: UPLOAD IMAGES
// ================================
router.post(
    "/upload/images",
    upload.array("images", 20),
    (req, res) => {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No images uploaded" });
        }

        const images = req.files.map(file => ({
            url: `/${UPLOAD_ROOT}/${file._uploadDir}/${file._filename}`,
            type: "image",
            name: file.originalname,
            size: file.size,
            mime: file.mimetype
        }));

        res.json({
            count: images.length,
            images
        });
    }
);

// ================================
// ROUTE: UPLOAD SINGLE FILE
// ================================
router.post(
    "/upload",
    upload.single("file"),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: "No file" });
        }

        const file = req.file;

        let type = "file";
        if (file.mimetype.startsWith("image/")) type = "image";
        else if (file.mimetype.startsWith("video/")) type = "video";
        else if (file.mimetype === "application/pdf") type = "pdf";

        res.json({
            url: `/${UPLOAD_ROOT}/${file._uploadDir}/${file._filename}`,
            type,
            name: file.originalname,
            size: file.size,
            mime: file.mimetype
        });
    }
);

export default router;
