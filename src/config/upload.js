import path from "path";

export const UPLOAD_ROOT = process.env.UPLOAD_ROOT_PATH || "documents";

export const UPLOAD_ROOT_ABS = path.resolve(UPLOAD_ROOT);
