import jwt from "jsonwebtoken";
import env from "../config/env.js";
import { getPool } from "../config/database.js";
import AppError from "../utils/app-error.js";
import { fetchOne } from "../utils/db-helpers.js";
import { hasAnyRole, toPublicUser } from "../utils/roles.js";

function extractToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  if (req.cookies?.[env.cookieName]) {
    return req.cookies[env.cookieName];
  }

  return null;
}

export async function authenticate(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return next(new AppError("Avval login qiling.", 401));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const pool = getPool();

    const session = await fetchOne(
      pool,
      `SELECT s.id, s.user_id, s.jti, s.expires_at, s.logged_out_at,
              u.id AS account_id, u.full_name, u.username, u.email, u.phone,
              u.role, u.location_id, u.avatar_path, u.status
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.jti = ? AND s.logged_out_at IS NULL AND s.expires_at > NOW()
       LIMIT 1`,
      [payload.sessionId, payload.jti]
    );

    if (!session) {
      throw new AppError("Sessiya yakunlangan yoki topilmadi.", 401);
    }

    if (session.status !== "active") {
      throw new AppError("Foydalanuvchi faol emas.", 403);
    }

    req.token = token;
    req.session = {
      id: session.id,
      userId: session.user_id,
      jti: session.jti,
      expiresAt: session.expires_at
    };
    req.user = {
      ...toPublicUser({
        id: session.account_id,
        full_name: session.full_name,
        username: session.username,
        email: session.email,
        phone: session.phone,
        role: session.role,
        location_id: session.location_id,
        avatar_path: session.avatar_path,
        status: session.status
      }),
      rawRole: session.role
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError("Avval login qiling.", 401));
    }

    if (roles.length > 0 && !hasAnyRole(req.user.role, roles)) {
      return next(new AppError("Sizda bu amal uchun ruxsat yo'q.", 403));
    }

    return next();
  };
}
