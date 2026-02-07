import { Router } from "express";
import { login, logout, getMe, refresh } from "#controllers/auth.controller.js";

const router = Router();

router.get("/me", getMe);

router.post("/login", login);
router.post("/logout", logout);

router.post("/refresh", refresh);

export default router;
