import jwt from "jsonwebtoken";

export default function authBearer(req, res, next) {
    const [, token] = (req.headers.authorization || "").split(" ");

    if (!token) return res.status(401).json({ error: "Missing token" });

    try {
        req.user = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        next();
    } catch {
        res.status(401).json({ error: "Invalid token" });
    }
}
