// src/services/entity.service.js
export async function findEntity(pool, table, where = {}) {

    const keys = Object.keys(where);

    if (!keys.length) return null;

    const conditions = keys
        .map((k, i) => `${k} = $${i + 1}`)
        .join(" AND ");

    const values = Object.values(where);

    const sql = `
        SELECT *
        FROM ${table}
        WHERE ${conditions}
        LIMIT 1
    `;

    const result = await pool.query(sql, values);

    return result.rows[0] || null;
}

export function buildJsonResponse({
    success = true,
    data = [],
    total = 0,
    page = 0,
    limit = 0,
    error = null
}) {
    if (!success) {
        return {
            success: false,
            error: error || "Internal Server Error"
        };
    }

    return {
        success: true,
        data,
        metadata: {
            total,
            page,
            limit
        }
    };
}

export async function getPaginatedResults({
    tableName,
    keyword = "",
    page = 0,
    limit = 0,
    searchColumn = "documents",
    orderBy = "code",
}) {
    if (page < 0) page = 0;
    if (limit < 0) limit = 0;

    let whereClause = "";
    if (keyword) {
        // escape keyword tránh SQL injection
        const safeKeyword = keyword.replace(/'/g, "''");
        whereClause = `WHERE ${searchColumn} LIKE UPPER_UNACCENT('%${safeKeyword}%')`;
    }

    const baseQuery = `
    SELECT *
    FROM ${tableName}
    ${whereClause}
    ORDER BY ${orderBy}
  `;

    const sql = `SELECT paginate($1, $2, $3) AS result;`;
    const { rows } = await pool.query(sql, [baseQuery, page, limit]);
    const result = JSON.parse(rows[0].result);

    return {
        payload: result.payload,
        total: result.total,
        page,
        limit,
    };
}
