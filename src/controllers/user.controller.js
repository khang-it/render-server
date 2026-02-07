import pool from "#db";

// // GET /api/users/me
// export async function getMe(req, res) {
//     const r = await pool.query(
//         "SELECT id,email,name,avatar,provider FROM users WHERE id=$1",
//         [req.user.sub]
//     );

//     res.json({ user: r.rows[0] || null });
// }

// GET /api/users
export async function getAllUsers(req, res) {
    const r = await pool.query(
        "SELECT id,email,name,avatar,provider FROM users ORDER BY name"
    );

    console.log('users:', r.rows)

    res.json({
        success: true,
        count: r.rows.length,
        users: r.rows,
    });
}

// GET /api/users/:id
export async function getUserById(req, res) {
    const { id } = req.params;

    const r = await pool.query(
        "SELECT id,email,name,avatar,provider FROM users WHERE id=$1",
        [id]
    );

    res.json({ user: r.rows[0] || null });
}
