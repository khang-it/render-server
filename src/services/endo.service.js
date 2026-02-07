import pool from "#db";
import { findEntity, getPaginatedResults } from "#services/entity.service.js";

// ===============================
// PAGINATED RESULTS
// ===============================
export async function getPaginatedResultsService({
    keyword,
    page,
    limit
}) {
    return getPaginatedResults({
        tableName: "results_mv",
        keyword,
        page,
        limit,
        searchColumn: "documents",
        orderBy: "result_date"
    });
}

// ===============================
// RESULT DOCUMENTS BY RECORD ID
// ===============================
export async function getResultDocumentsService(recordId) {
    const sql = `
        SELECT
            mediainfo_id AS id,
            encode(mediablob, 'base64') AS base64,
            endoscopicmedicalrecord_id,
            date_created
        FROM public."MediaInfo"
        WHERE endoscopicmedicalrecord_id = $1
          AND deleted = 0
        ORDER BY date_created
    `;

    const { rows } = await pool.query(sql, [recordId]);

    const object =
        await findEntity(pool, "results_mv", { id_iuid: recordId }) || {};

    return {
        documents: rows.map(r => ({
            id: r.id,
            record_id: r.endoscopicmedicalrecord_id,
            date_created: r.date_created,
            base64: r.base64
        })),
        object
    };
}
