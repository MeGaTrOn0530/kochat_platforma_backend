import { Router } from "express";
import bcrypt from "bcryptjs";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import AppError from "../utils/app-error.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { buildUpdateColumns, fetchOne } from "../utils/db-helpers.js";
import { requireFields, toNullableInt } from "../utils/validation.js";
import { logActivity } from "../utils/activity.js";
import { sendCreated, sendOk } from "../utils/http.js";
import { normalizeRole, toPublicUser } from "../utils/roles.js";
import { removeUploadedFiles, saveProfileImages } from "../utils/upload-storage.js";

const router = Router();

router.use(authenticate);

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const user = await fetchOne(
      pool,
      `SELECT id, full_name, username, email, phone, role, location_id, avatar_path,
              status, created_at, updated_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id]
    );

    if (!user) {
      throw new AppError("Foydalanuvchi topilmadi.", 404);
    }

    return sendOk(res, toPublicUser(user));
  })
);

router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const existingUser = await fetchOne(
      pool,
      `SELECT id, full_name, username, email, phone, password_hash, role, location_id, avatar_path,
              status
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id]
    );

    if (!existingUser) {
      throw new AppError("Foydalanuvchi topilmadi.", 404);
    }

    let passwordHash;
    if (req.body.newPassword) {
      requireFields(req.body, ["currentPassword"]);
      const passwordMatches = await bcrypt.compare(req.body.currentPassword, existingUser.password_hash);

      if (!passwordMatches) {
        throw new AppError("Joriy parol noto'g'ri.", 400);
      }

      passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    }

    let avatarPath;
    if (req.body.avatar?.dataUrl) {
      const [savedAvatar] = await saveProfileImages([req.body.avatar], {
        prefix: req.body.username || existingUser.username || "profile",
      });

      avatarPath = savedAvatar || null;
      if (existingUser.avatar_path) {
        await removeUploadedFiles([existingUser.avatar_path]);
      }
    }

    const updates = buildUpdateColumns({
      full_name: req.body.fullName,
      username: req.body.username,
      email: req.body.email,
      phone: req.body.phone,
      password_hash: passwordHash,
      avatar_path: avatarPath,
    });

    if (!updates.hasValues) {
      throw new AppError("Yangilash uchun kamida bitta maydon yuboring.", 400);
    }

    await pool.query(`UPDATE users SET ${updates.sql} WHERE id = ?`, [...updates.values, req.user.id]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "user_updated",
      entityType: "user",
      entityId: req.user.id,
      description: `${existingUser.full_name} profili yangilandi`,
    });

    const updatedUser = await fetchOne(
      pool,
      `SELECT id, full_name, username, email, phone, role, location_id, avatar_path,
              status, created_at, updated_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id]
    );

    return sendOk(res, toPublicUser(updatedUser), "Profil yangilandi.");
  })
);

router.get(
  "/",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const conditions = ["1 = 1"];
    const params = [];

    if (req.query.role) {
      conditions.push("u.role = ?");
      params.push(req.query.role);
    }

    if (req.query.status) {
      conditions.push("u.status = ?");
      params.push(req.query.status);
    }

    if (req.query.locationId) {
      conditions.push("u.location_id = ?");
      params.push(req.query.locationId);
    }

    if (req.query.search) {
      const pattern = `%${req.query.search}%`;
      conditions.push("(u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)");
      params.push(pattern, pattern, pattern);
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role, u.location_id, u.avatar_path,
              u.status, u.created_at, u.updated_at,
              l.name AS location_name, l.code AS location_code
       FROM users u
       LEFT JOIN locations l ON l.id = u.location_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY u.id DESC`,
      params
    );

    return sendOk(res, rows.map((row) => toPublicUser(row)));
  })
);

router.post(
  "/",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const fullName = req.body.fullName || req.body.name;
    requireFields({ ...req.body, fullName }, ["fullName", "username", "password", "role"]);

    const pool = getPool();
    const locationId = toNullableInt(req.body.locationId, "locationId");
    const role = normalizeRole(req.body.role);

    if (locationId) {
      const location = await fetchOne(pool, "SELECT id FROM locations WHERE id = ? LIMIT 1", [locationId]);

      if (!location) {
        throw new AppError("Tanlangan lokatsiya topilmadi.", 404);
      }
    }

    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const [result] = await pool.query(
      `INSERT INTO users
        (full_name, username, email, phone, password_hash, role, location_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullName,
        req.body.username,
        req.body.email || null,
        req.body.phone || null,
        passwordHash,
        role,
        locationId,
        req.body.status || "active"
      ]
    );

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "user_created",
      entityType: "user",
      entityId: result.insertId,
      description: `${fullName} foydalanuvchisi yaratildi`
    });

    const createdUser = await fetchOne(
      pool,
      `SELECT id, full_name, username, email, phone, role, location_id, avatar_path,
              status, created_at, updated_at
       FROM users
       WHERE id = ?`,
      [result.insertId]
    );

    return sendCreated(res, toPublicUser(createdUser), "Foydalanuvchi yaratildi.");
  })
);

router.put(
  "/:id",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const userId = Number.parseInt(req.params.id, 10);
    const existingUser = await fetchOne(pool, "SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);

    if (!existingUser) {
      throw new AppError("Foydalanuvchi topilmadi.", 404);
    }

    const locationId =
      req.body.locationId === undefined ? undefined : toNullableInt(req.body.locationId, "locationId");

    if (locationId) {
      const location = await fetchOne(pool, "SELECT id FROM locations WHERE id = ? LIMIT 1", [locationId]);

      if (!location) {
        throw new AppError("Tanlangan lokatsiya topilmadi.", 404);
      }
    }

    let passwordHash;
    if (req.body.password) {
      passwordHash = await bcrypt.hash(req.body.password, 10);
    }

    const updates = buildUpdateColumns({
      full_name: req.body.fullName || req.body.name,
      username: req.body.username,
      email: req.body.email,
      phone: req.body.phone,
      password_hash: passwordHash,
      role: req.body.role !== undefined ? normalizeRole(req.body.role) : undefined,
      location_id: locationId,
      status: req.body.status
    });

    if (!updates.hasValues) {
      throw new AppError("Yangilash uchun kamida bitta maydon yuboring.", 400);
    }

    await pool.query(`UPDATE users SET ${updates.sql} WHERE id = ?`, [...updates.values, userId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "user_updated",
      entityType: "user",
      entityId: userId,
      description: `Foydalanuvchi #${userId} yangilandi`
    });

    const updatedUser = await fetchOne(
      pool,
      `SELECT id, full_name, username, email, phone, role, location_id, avatar_path,
              status, created_at, updated_at
       FROM users
       WHERE id = ?`,
      [userId]
    );

    return sendOk(res, toPublicUser(updatedUser), "Foydalanuvchi yangilandi.");
  })
);

router.delete(
  "/:id",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const userId = Number.parseInt(req.params.id, 10);

    if (req.user.id === userId) {
      throw new AppError("O'zingizni o'chira olmaysiz.", 400);
    }

    const existingUser = await fetchOne(
      pool,
      "SELECT id, full_name, avatar_path FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    if (!existingUser) {
      throw new AppError("Foydalanuvchi topilmadi.", 404);
    }

    await removeUploadedFiles([existingUser.avatar_path].filter(Boolean));

    await pool.query("DELETE FROM users WHERE id = ?", [userId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "user_deleted",
      entityType: "user",
      entityId: userId,
      description: `${existingUser.full_name} foydalanuvchisi o'chirildi`
    });

    return sendOk(res, null, "Foydalanuvchi o'chirildi.");
  })
);

export default router;
