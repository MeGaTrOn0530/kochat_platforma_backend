import { isSafeMethod, isOriginTrusted, extractRequestOrigin } from "../utils/security.js";
import env from "../config/env.js";
import AppError from "../utils/app-error.js";

export function attachApiSecurityHeaders(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
}

/**
 * CSRF himoyasi: state-changing so'rovlar (POST/PUT/PATCH/DELETE) uchun
 * Origin yoki Referer headerini tekshiradi.
 *
 * Browser har doim Origin/Referer yuboradi — agar yo'q bo'lsa bu
 * curl/Postman/server-to-server bo'lishi mumkin. Development da o'tkazib yuboradi,
 * production da sxema bo'yicha baholaydi.
 */
export function requireTrustedOrigin(req, res, next) {
  // GET/HEAD/OPTIONS — o'zgartiruvchi emas, ruxsat
  if (isSafeMethod(req.method)) {
    return next();
  }

  // CORS_ORIGIN=* bo'lsa (development muhiti) — o'tkazib yuboramiz
  if (env.corsOrigin === "*") {
    return next();
  }

  const origin = extractRequestOrigin(req);

  // Origin/Referer yuborilmagan (API client, mobile app) — ruxsat
  // Ammo faqat authentication cookie orqali emas
  if (!origin) {
    return next();
  }

  // Origin ruxsat etilganlar ro'yxatida emasmi?
  if (!isOriginTrusted(origin, env, req)) {
    return next(
      new AppError("So'rov manbasi ishonchsiz. CSRF hujumi aniqlangan bo'lishi mumkin.", 403)
    );
  }

  return next();
}
