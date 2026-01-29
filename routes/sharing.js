import express from "express";
import pool from "../db.js";

const router = express.Router();

/**
 * GET /api/conversations/:id/documents
 */
router.get("/conversations/:id/documents", async (req, res) => {
    const { id } = req.params;

    const { rows } = await pool.query(`
    SELECT
      id,
      content AS url,
      type,
      created_at
    FROM messages
    WHERE conversation_id = $1
      AND type IN ('media','album','link')
    ORDER BY created_at DESC
    LIMIT 200
  `, [id]);

    // flatten album
    const results = [];

    for (const r of rows) {
        if (r.type === 'album') {
            try {
                const parsed = JSON.parse(r.url);
                for (const u of parsed.urls || []) {
                    results.push({
                        id: r.id,
                        url: u,
                        mediaType: 'image',
                        created_at: r.created_at
                    });
                }
            } catch { }
        } else {
            results.push({
                id: r.id,
                url: r.url,
                mediaType: r.mediatype,
                name: r.name,
                created_at: r.created_at
            });
        }
    }

    res.json({ documents: results });
});

export default router;
