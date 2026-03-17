import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import env from "../config/env.js";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import AppError from "../utils/app-error.js";
import { fetchOne } from "../utils/db-helpers.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireFields } from "../utils/validation.js";
import { createRateLimiter, getRateLimitIp } from "../middlewares/rate-limit.middleware.js";
import { logActivity } from "../utils/activity.js";
import { sendOk } from "../utils/http.js";
import { toPublicUser } from "../utils/roles.js";
import { clearAuthCookie, setAuthCookie } from "../utils/auth-cookie.js";

const router = Router();
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 7,
  keyGenerator: (req) =>
    `${getRateLimitIp(req)}:login:${String(req.body?.username || req.body?.login || "").trim().toLowerCase()}`,
  message: "Login urinishlari juda ko'p. 15 daqiqadan keyin qayta urinib ko'ring.",
});

function signToken(userId, role, sessionId, jti) {
  return jwt.sign(
    {
      sub: String(userId),
      role,
      sessionId,
      jti
    },
    env.jwtSecret,
    {
      expiresIn: `${env.jwtExpiresHours}h`
    }
  );
}

async function startSession(pool, user, res, options = {}) {
  const sessionId = randomUUID();
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + env.jwtExpiresHours * 60 * 60 * 1000);
  const token = signToken(user.id, user.role, sessionId, jti);

  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, jti, expires_at)
     VALUES (?, ?, ?, ?)`,
    [sessionId, user.id, jti, expiresAt]
  );

  await logActivity(pool, {
    actorUserId: user.id,
    action: options.action || "login",
    entityType: "auth",
    entityId: sessionId,
    description: options.description || `${user.full_name} tizimga kirdi`,
    metadata: options.metadata,
  });

  setAuthCookie(res, token);

  return {
    user: toPublicUser(user),
  };
}

router.post(
  "/login",
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ["password"]);

    const username = String(req.body.username || req.body.login || "").trim();

    if (!username) {
      throw new AppError("username yoki login yuborilishi kerak.", 400);
    }

    const pool = getPool();
    const user = await fetchOne(
      pool,
      `SELECT id, full_name, username, email, phone, password_hash, role, location_id, avatar_path,
              status
       FROM users
       WHERE username = ? OR email = ?
       LIMIT 1`,
      [username, username]
    );

    if (!user) {
      throw new AppError("Login yoki parol noto'g'ri.", 401);
    }

    if (user.status !== "active") {
      throw new AppError("Bu foydalanuvchi bloklangan yoki faol emas.", 403);
    }

    const passwordMatches = await bcrypt.compare(req.body.password, user.password_hash);

    if (!passwordMatches) {
      throw new AppError("Login yoki parol noto'g'ri.", 401);
    }

    const sessionPayload = await startSession(pool, user, res, {
      action: "login",
      description: `${user.full_name} tizimga kirdi`,
    });

    return sendOk(
      res,
      sessionPayload,
      "Login muvaffaqiyatli bajarildi."
    );
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    const pool = getPool();

    await pool.query("UPDATE auth_sessions SET logged_out_at = NOW() WHERE id = ?", [req.session.id]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "logout",
      entityType: "auth",
      entityId: req.session.id,
      description: `${req.user.fullName} tizimdan chiqdi`
    });

    clearAuthCookie(res);

    return sendOk(res, null, "Logout bajarildi.");
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    return sendOk(res, toPublicUser(req.user));
  })
);

export default router;
