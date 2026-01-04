import express from "express";
import multer from "multer";
import mime from "mime-types";
import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs";

const router = express.Router();

// ================================
// CONFIG STORAGE
// ================================
const storage = multer.diskStorage({
    destination(req, file, cb) {
        const type = file.mimetype;

        let dir = "files";
        if (type.startsWith("image/")) dir = "images";
        else if (type.startsWith("video/")) dir = "videos";

        const uploadPath = `uploads/${dir}`;
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },

    filename(req, file, cb) {
        const ext = mime.extension(file.mimetype) || "bin";
        cb(null, `${uuid()}.${ext}`);
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
// ROUTE
// ================================

router.post(
    "/upload/images",
    upload.array("images", 20), // tối đa 20 ảnh
    (req, res) => {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No images uploaded" });
        }

        const baseUrl = `${req.protocol}://${req.get("host")}`;

        const images = req.files.map(file => {
            if (!file.mimetype.startsWith("image/")) return null;

            return {
                url: `${baseUrl}/${file.path}`,
                type: "image",
                name: file.originalname,
                size: file.size,
                mime: file.mimetype
            };
        }).filter(Boolean);

        res.json({
            count: images.length,
            images
        });
    }
);

router.post(
    "/upload",
    upload.single("file"),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: "No file" });
        }

        const file = req.file;

        //console.log('file:', file);

        let type = "file";
        if (file.mimetype.startsWith("image/")) type = "image";
        else if (file.mimetype.startsWith("video/")) type = "video";

        const url = `${req.protocol}://${req.get("host")}/${file.path}`;

        res.json({
            url,
            type,
            name: file.originalname,
            size: file.size,
            mime: file.mimetype
        });
    }
);



export default router;
