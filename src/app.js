import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { UPLOAD_ROOT, UPLOAD_ROOT_ABS } from "#config/upload.js";
import corsOptions from "#config/cors.js";

import authRoutes from "#routes/auth.route.js";
import userRoutes from "#routes/users.js";
import uploadRoutes from "#routes/upload.js";
import stickerRoutes from "#routes/sticker.js";
import sharingRoutes from "#routes/sharing.js";
//import endoRoutes from "#routes/endo.route.js";

import notFound from "#middlewares/notFound.js";
import errorHandler from "#middlewares/errorHandler.js";

const app = express();

app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));

app.use(`/${UPLOAD_ROOT}`, express.static(UPLOAD_ROOT_ABS));

app.use("/auth", authRoutes);
app.use("/api/users", userRoutes);
//app.use("/api/endo", endoRoutes);
app.use("/api", uploadRoutes);
app.use("/api", stickerRoutes);
app.use("/api", sharingRoutes);


// 404 - NOT MATCH ROUTE
app.use(notFound);

// ERROR HANDLER
app.use(errorHandler);

export default app;
