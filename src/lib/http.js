/** async 라우트의 에러를 express 에러 처리기로 넘긴다 */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(status).json({ error: status >= 500 ? '서버 오류가 발생했습니다' : err.message });
}
