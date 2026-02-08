// function notFound(req, res, next) {
//     const error = new Error("API not found");
//     error.status = 404;
//     next(error);
// }

function notFound(req, res, next) {
    const isApi = req.originalUrl.startsWith("/api");

    const error = new Error(
        isApi ? "API not found" : "Resource not found"
    );

    error.status = 404;
    next(error);
}

export default notFound;