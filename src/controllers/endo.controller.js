import {
    getPaginatedResultsService,
    getResultDocumentsService
} from "#services/endo.service.js";

import { buildJsonResponse } from "#services/entity.service.js";

// ===============================
// GET /api/endo/results
// ===============================
export async function getPaginatedEndoResults(req, res, next) {
    try {
        const keyword = req.query.keyword || "";
        const page = parseInt(req.query.page, 10) || 0;
        const limit = parseInt(req.query.limit, 10) || 0;

        const result = await getPaginatedResultsService({
            keyword,
            page,
            limit
        });

        res.json(
            buildJsonResponse({
                data: result.payload,
                total: result.total,
                page: result.page,
                limit: result.limit
            })
        );
    } catch (err) {
        console.error("Endo results error:", err);
        next(err);
    }
}

// ===============================
// GET /api/endo/result-documents/:id
// ===============================
export async function getResultDocuments(req, res, next) {
    try {
        const { id } = req.params;

        const result = await getResultDocumentsService(id);

        res.json({
            success: true,
            data: result.documents,
            object: result.object
        });
    } catch (err) {
        console.error("Result documents error:", err);
        next(err);
    }
}
