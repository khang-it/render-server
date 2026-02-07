import { Router } from "express";
import {
    getPaginatedEndoResults,
    getResultDocuments
} from "#controllers/endo.controller.js";

const router = Router();

/**
 * GET /api/endo/results
 * Query: keyword, page, limit
 */
router.get("/results", getPaginatedEndoResults);

/**
 * GET /api/endo/result-documents/:id
 */
router.get("/result-documents/:id", getResultDocuments);

export default router;
