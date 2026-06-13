import AppError from "../utils/app-error.js";

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function createRateLimiter({
  windowMs,
  max,
  keyGenerator,
  message,
}) {
  const hits = new Map();
  let requestCount = 0;

  return (req, res, next) => {
    const now = Date.now();
    requestCount += 1;

    if (requestCount % 200 === 0 && hits.size > 0) {
      for (const [entryKey, entryValue] of hits.entries()) {
        if (entryValue.resetAt <= now) {
          hits.delete(entryKey);
        }
      }
    }

    const key =
      keyGenerator?.(req) ||
      `${getClientIp(req)}:${req.method}:${req.baseUrl || ""}:${req.path || req.originalUrl || ""}`;

    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return next();
    }

    current.count += 1;
    hits.set(key, current);

    if (current.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));

      return next(
        new AppError(message || "So'rovlar soni juda ko'p. Keyinroq qayta urinib ko'ring.", 429, {
          retryAfterSeconds,
        })
      );
    }

    return next();
  };
}

export function getRateLimitIp(req) {
  return getClientIp(req);
}
