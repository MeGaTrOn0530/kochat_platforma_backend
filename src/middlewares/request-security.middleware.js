import { isSafeMethod } from "../utils/security.js";

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

  return next();
}
