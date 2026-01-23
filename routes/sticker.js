import express from "express";
import pool from "../db.js";

const router = express.Router();

/* ======================================================
   📦 GET ALL STICKER PACKS (STORE)
====================================================== */
router.get("/sticker-packs", async (req, res) => {
    const userId = req.user.sub;

    const { rows } = await pool.query(
        `
    SELECT 
      sp.id,
      sp.name,
      sp.icon,
      sp.description,
      EXISTS (
        SELECT 1 
        FROM user_sticker_packs usp
        WHERE usp.pack_id = sp.id
          AND usp.user_id = $1
      ) AS downloaded
    FROM sticker_packs sp
    ORDER BY sp.created_at
    `,
        [userId]
    );

    res.json(rows);
});

/* ======================================================
   🖼 GET STICKERS BY PACK
====================================================== */
router.get("/sticker-packs/:id/stickers", async (req, res) => {
    const { id } = req.params;

    const { rows } = await pool.query(
        `
    SELECT id, name, url, width, height, size
    FROM stickers
    WHERE pack_id = $1
    ORDER BY id
    `,
        [id]
    );

    res.json(rows);
});

/* ======================================================
   ⬇️ DOWNLOAD PACK
====================================================== */
router.post("/sticker-packs/:id/download", async (req, res) => {
    const userId = req.user.sub;
    const { id } = req.params;

    await pool.query(
        `
    INSERT INTO user_sticker_packs (user_id, pack_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    `,
        [userId, id]
    );

    res.json({ success: true });
});

/* ======================================================
   📦 GET MY STICKER PACKS
====================================================== */
router.get("/my-sticker-packs", async (req, res) => {
    const userId = req.user.sub;

    const { rows } = await pool.query(
        `
    SELECT 
      sp.id,
      sp.name,
      sp.icon,
      sp.description,
      usp.sort_order
    FROM user_sticker_packs usp
    JOIN sticker_packs sp ON sp.id = usp.pack_id
    WHERE usp.user_id = $1
    ORDER BY usp.sort_order ASC
    `,
        [userId]
    );

    res.json(rows);
});

/* ======================================================
   🔀 SORT MY PACKS
====================================================== */
router.post("/my-sticker-packs/sort", async (req, res) => {
    const userId = req.user.sub;
    const { orders } = req.body; // [{ pack_id, sort_order }]

    if (!Array.isArray(orders)) {
        return res.status(400).json({ error: "Invalid orders" });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const { pack_id, sort_order } of orders) {
            if (pack_id === "recent") continue; // 🛑 guard

            await client.query(
                `
        UPDATE user_sticker_packs
        SET sort_order = $1
        WHERE user_id = $2 AND pack_id = $3
        `,
                [sort_order, userId, pack_id]
            );
        }

        await client.query("COMMIT");
        res.json({ success: true });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Sort sticker packs error:", err);
        res.status(500).json({ error: "Sort failed" });
    } finally {
        client.release();
    }
});

/* ======================================================
   🗑 REMOVE PACK FROM USER
====================================================== */
router.delete("/my-sticker-packs/:packId", async (req, res) => {
    const userId = req.user.sub;
    const { packId } = req.params;

    await pool.query(
        `
    DELETE FROM user_sticker_packs
    WHERE user_id = $1 AND pack_id = $2
    `,
        [userId, packId]
    );

    res.json({ success: true });
});

export default router;
