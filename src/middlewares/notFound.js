function notFound(req, res, next) {
    const error = new Error("API not found");
    error.status = 404;
    next(error);
}

export default notFound;