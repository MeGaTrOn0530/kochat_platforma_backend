import AppError from "./app-error.js";

const DEFAULT_JWT_SECRET = "change_me_in_production";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeOriginValue(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(String(value)).origin;
  } catch {
    return String(value).trim().replace(/\/+$/, "");
  }
}

export function parseAllowedOrigins(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeOriginValue(item))
    .filter(Boolean);
}

export function assertSecureProductionEnv(env) {
  if (env.nodeEnv !== "production") {
    return;
  }

  const missing = [];
  const wantsBootstrapAdmin = Boolean(env.defaultAdminUsername || env.defaultAdminPassword);

  if (!env.jwtSecret || env.jwtSecret === DEFAULT_JWT_SECRET) {
    missing.push("JWT_SECRET");
  }

  if (!env.dbPassword) {
    missing.push("DB_PASSWORD");
  }

  if (!env.corsOrigin || env.corsOrigin === "*") {
    missing.push("CORS_ORIGIN");
  }

  if (wantsBootstrapAdmin) {
    if (!env.defaultAdminUsername) {
      missing.push("DEFAULT_ADMIN_USERNAME");
    }

    if (!env.defaultAdminPassword) {
      missing.push("DEFAULT_ADMIN_PASSWORD");
    } else {
      try {
        assertStrongPassword(env.defaultAdminPassword);
      } catch {
        missing.push("DEFAULT_ADMIN_PASSWORD");
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Production xavfsizlik sozlamalari to'liq emas: ${missing.join(", ")}. Default qiymatlar bilan server ishga tushirilmaydi.`
    );
  }
}

export function isSafeMethod(method) {
  return SAFE_METHODS.has(String(method || "").toUpperCase());
}

export function extractRequestOrigin(req) {
  const origin = req.get("origin");
  if (origin) {
    return normalizeOriginValue(origin);
  }

  const referer = req.get("referer");
  if (referer) {
    return normalizeOriginValue(referer);
  }

  return null;
}

export function getRequestPublicOrigin(req) {
  const forwardedProto = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.get("x-forwarded-host") || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || req.get("host");
  const protocol = forwardedProto || req.protocol || "http";

  if (!host) {
    return null;
  }

  return normalizeOriginValue(`${protocol}://${host}`);
}

export function getTrustedOrigins(env, req) {
  const trustedOrigins = new Set(env.allowedOrigins || []);
  const requestPublicOrigin = getRequestPublicOrigin(req);

  if (requestPublicOrigin) {
    trustedOrigins.add(requestPublicOrigin);
  }

  return trustedOrigins;
}

export function isOriginTrusted(origin, env, req) {
  if (!origin || env.corsOrigin === "*") {
    return true;
  }

  const normalizedOrigin = normalizeOriginValue(origin);
  if (!normalizedOrigin) {
    return false;
  }

  return getTrustedOrigins(env, req).has(normalizedOrigin);
}

export function assertStrongPassword(password) {
  const value = String(password || "");

  if (value.length < 10) {
    throw new AppError("Parol kamida 10 ta belgidan iborat bo'lishi kerak.", 400);
  }

  if (!/[a-z]/.test(value)) {
    throw new AppError("Parolda kamida 1 ta kichik harf bo'lishi kerak.", 400);
  }

  if (!/[A-Z]/.test(value)) {
    throw new AppError("Parolda kamida 1 ta katta harf bo'lishi kerak.", 400);
  }

  if (!/[0-9]/.test(value)) {
    throw new AppError("Parolda kamida 1 ta raqam bo'lishi kerak.", 400);
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    throw new AppError("Parolda kamida 1 ta maxsus belgi bo'lishi kerak.", 400);
  }
}

export function assertValidUsername(username) {
  const value = String(username || "").trim();

  if (value.length < 4 || value.length > 32) {
    throw new AppError("Username 4 dan 32 tagacha belgidan iborat bo'lishi kerak.", 400);
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new AppError("Username faqat harf, raqam, nuqta, pastki chiziq va defisdan iborat bo'lishi mumkin.", 400);
  }
}

export function ensureUniqueFieldsPayload(username, email) {
  return {
    username: username ? String(username).trim() : null,
    email: email ? String(email).trim().toLowerCase() : null,
  };
}
