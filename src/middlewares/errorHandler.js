// ./src/middlewares/errorHandler.js
// function errorHandler(err, req, res, next) {
//     console.error(err);

//     res.status(err.status || 500).json({
//         success: false,
//         message: err.message || "Internal Server Error",
//     });
// }

function errorHandler(err, req, res, next) {
    const status = err.status || 500;

    // ❗ Chỉ log stack trace khi lỗi nghiêm trọng
    if (status >= 500) {
        console.error(err);
    } else {
        console.warn(`[${status}] ${req.method} ${req.originalUrl} - ${err.message}`);
    }

    res.status(status).json({
        success: false,
        message: err.message || "Internal Server Error",
    });
}

export default errorHandler;
