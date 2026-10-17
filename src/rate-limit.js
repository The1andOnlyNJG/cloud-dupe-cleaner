// @ts-check

/**
 * Fixed-window rate limiter keyed by client IP only. The table is bounded so
 * random paths or many clients cannot grow memory without limit.
 * @param {{ windowMs: number, max: number, maxKeys?: number }} options
 */
export function createRateLimiter(options) {
  const maxKeys = options.maxKeys ?? 10_000;
  /** @type {Map<string, { start: number, count: number }>} */
  const hits = new Map();
  let lastSweep = Date.now();
  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return function rateLimit(req, res, next) {
    const now = Date.now();
    if (now - lastSweep > options.windowMs) {
      for (const [k, v] of hits) if (now - v.start >= options.windowMs) hits.delete(k);
      lastSweep = now;
    }
    const key = String(req.ip || 'unknown');
    let entry = hits.get(key);
    if (!entry || now - entry.start >= options.windowMs) {
      if (!entry && hits.size >= maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    const setHeader = typeof res.set === 'function' ? res.set.bind(res) : () => res;
    setHeader('RateLimit-Limit', String(options.max));
    setHeader('RateLimit-Remaining', String(Math.max(0, options.max - entry.count)));
    if (entry.count > options.max) {
      setHeader('Retry-After', String(Math.ceil((entry.start + options.windowMs - now) / 1000)));
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
      return;
    }
    next();
  };
}
