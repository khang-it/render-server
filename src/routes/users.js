import { Router } from "express";
// import authBearer from "#middlewares/authBearer.js";
import {
    getAllUsers,
    getUserById,
} from "#controllers/user.controller.js";

const router = Router();

router.get("/:id", getUserById);

router.get("/", getAllUsers);

export default router;
