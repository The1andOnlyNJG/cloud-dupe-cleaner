// @ts-check

/**
 * @param {{ windowMs: number, max: number }} options
 */
export function createRateLimiter(options) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = `${req.ip}|${req.path}`;
    const recent = (hits.get(key) || []).filter((time) => now - time < options.windowMs);
    if (recent.length >= options.max) {
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
