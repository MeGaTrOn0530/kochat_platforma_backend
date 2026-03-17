import { Router } from "express";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import AppError from "../utils/app-error.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { buildUpdateColumns, fetchOne } from "../utils/db-helpers.js";
import { requireFields, toNullableInt } from "../utils/validation.js";
import { logActivity } from "../utils/activity.js";
import { sendCreated, sendOk } from "../utils/http.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const conditions = ["1 = 1"];
    const params = [];

    if (req.query.status) {
      conditions.push("t.status = ?");
      params.push(req.query.status);
    }

    if (req.query.priority) {
      conditions.push("t.priority = ?");
      params.push(req.query.priority);
    }

    if (req.query.locationId) {
      conditions.push("t.location_id = ?");
      params.push(req.query.locationId);
    }

    if (req.query.assignedTo) {
      conditions.push("t.assigned_to = ?");
      params.push(req.query.assignedTo);
    }

    if (req.query.search) {
      const pattern = `%${req.query.search}%`;
      conditions.push("(t.title LIKE ? OR t.description LIKE ?)");
      params.push(pattern, pattern);
    }

    const [rows] = await pool.query(
      `SELECT t.*, l.name AS location_name, au.full_name AS assigned_to_name, cu.full_name AS created_by_name
       FROM tasks t
       LEFT JOIN locations l ON l.id = t.location_id
       LEFT JOIN users au ON au.id = t.assigned_to
       LEFT JOIN users cu ON cu.id = t.created_by
       WHERE ${conditions.join(" AND ")}
       ORDER BY t.id DESC`,
      params
    );

    return sendOk(res, rows);
  })
);

router.post(
  "/",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ["title"]);

    const pool = getPool();
    const locationId = toNullableInt(req.body.locationId, "locationId");
    const assignedTo = toNullableInt(req.body.assignedTo, "assignedTo");

    if (locationId) {
      const location = await fetchOne(pool, "SELECT id FROM locations WHERE id = ? LIMIT 1", [locationId]);
      if (!location) {
        throw new AppError("Lokatsiya topilmadi.", 404);
      }
    }

    if (assignedTo) {
      const user = await fetchOne(pool, "SELECT id FROM users WHERE id = ? LIMIT 1", [assignedTo]);
      if (!user) {
        throw new AppError("Assigned user topilmadi.", 404);
      }
    }

    const status = req.body.status || "open";
    const priority = req.body.priority || "medium";
    const completedAt = status === "done" ? new Date() : null;

    const [result] = await pool.query(
      `INSERT INTO tasks
        (title, description, location_id, assigned_to, created_by, status, priority, due_date, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.body.title,
        req.body.description || null,
        locationId,
        assignedTo,
        req.user.id,
        status,
        priority,
        req.body.dueDate || null,
        completedAt
      ]
    );

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "task_created",
      entityType: "task",
      entityId: result.insertId,
      description: `${req.body.title} task yaratildi`
    });

    const task = await fetchOne(pool, "SELECT * FROM tasks WHERE id = ?", [result.insertId]);
    return sendCreated(res, task, "Task yaratildi.");
  })
);

router.put(
  "/:id",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const taskId = Number.parseInt(req.params.id, 10);
    const existingTask = await fetchOne(pool, "SELECT * FROM tasks WHERE id = ? LIMIT 1", [taskId]);

    if (!existingTask) {
      throw new AppError("Task topilmadi.", 404);
    }

    const locationId =
      req.body.locationId === undefined ? undefined : toNullableInt(req.body.locationId, "locationId");
    const assignedTo =
      req.body.assignedTo === undefined ? undefined : toNullableInt(req.body.assignedTo, "assignedTo");

    if (locationId) {
      const location = await fetchOne(pool, "SELECT id FROM locations WHERE id = ? LIMIT 1", [locationId]);
      if (!location) {
        throw new AppError("Lokatsiya topilmadi.", 404);
      }
    }

    if (assignedTo) {
      const user = await fetchOne(pool, "SELECT id FROM users WHERE id = ? LIMIT 1", [assignedTo]);
      if (!user) {
        throw new AppError("Assigned user topilmadi.", 404);
      }
    }

    let completedAt = undefined;
    if (req.body.status !== undefined) {
      completedAt = req.body.status === "done" ? new Date() : null;
    }

    const updates = buildUpdateColumns({
      title: req.body.title,
      description: req.body.description,
      location_id: locationId,
      assigned_to: assignedTo,
      status: req.body.status,
      priority: req.body.priority,
      due_date: req.body.dueDate,
      completed_at: completedAt
    });

    if (!updates.hasValues) {
      throw new AppError("Yangilash uchun kamida bitta maydon yuboring.", 400);
    }

    await pool.query(`UPDATE tasks SET ${updates.sql} WHERE id = ?`, [...updates.values, taskId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "task_updated",
      entityType: "task",
      entityId: taskId,
      description: `Task #${taskId} yangilandi`
    });

    const task = await fetchOne(pool, "SELECT * FROM tasks WHERE id = ?", [taskId]);
    return sendOk(res, task, "Task yangilandi.");
  })
);

export default router;
