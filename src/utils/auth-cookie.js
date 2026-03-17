import env from "../config/env.js";

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: env.nodeEnv === "production" ? "none" : "lax",
    secure: env.nodeEnv === "production",
    maxAge: env.jwtExpiresHours * 60 * 60 * 1000,
    path: "/",
  };
}

export function setAuthCookie(res, token) {
  res.cookie(env.cookieName, token, getCookieOptions());
}

export function clearAuthCookie(res) {
  res.clearCookie(env.cookieName, getCookieOptions());
}
