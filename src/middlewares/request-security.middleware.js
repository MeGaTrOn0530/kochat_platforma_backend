import env from "../config/env.js";
import AppError from "../utils/app-error.js";
import { extractRequestOrigin, isOriginTrusted, isSafeMethod } from "../utils/security.js";

export function attachApiSecurityHeaders(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
}

export function requireTrustedOrigin(req, res, next) {
  if (isSafeMethod(req.method)) {
    return next();
  }

  if (env.corsOrigin === "*") {
    return next();
  }

  const requestOrigin = extractRequestOrigin(req);

  if (!requestOrigin) {
    return next(new AppError("So'rov manbasi tasdiqlanmadi.", 403));
  }

  if (!isOriginTrusted(requestOrigin, env, req)) {
    return next(
      new AppError("Bu origin uchun ruxsat yo'q.", 403, {
        origin: requestOrigin,
      })
    );
  }

  return next();
}
