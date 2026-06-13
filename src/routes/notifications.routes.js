import { Router } from "express";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import AppError from "../utils/app-error.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { fetchOne } from "../utils/db-helpers.js";
import { toPositiveInt } from "../utils/validation.js";
import { sendOk } from "../utils/http.js";
import { getUnreadNotificationsCount } from "../utils/notifications.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const limit = Math.min(Math.max(Number(req.query.limit || 12), 1), 50);
    const unreadOnly = req.query.unreadOnly === "true";

    const conditions = ["n.recipient_user_id = ?"];
    const params = [req.user.id];

    if (unreadOnly) {
      conditions.push("n.is_read = 0");
    }

    const [items] = await pool.query(
      `SELECT n.*, u.full_name AS created_by_name, l.name AS location_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.created_by
       LEFT JOIN locations l ON l.id = n.location_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY n.is_read ASC, n.created_at DESC
       LIMIT ?`,
      [...params, limit]
    );

    const unreadCount = await getUnreadNotificationsCount(pool, req.user.id);

    return sendOk(res, {
      unreadCount,
      items,
    });
  })
);

router.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const notificationId = toPositiveInt(req.params.id, "notificationId");

    const notification = await fetchOne(
      pool,
      `SELECT *
       FROM notifications
       WHERE id = ?
         AND recipient_user_id = ?
       LIMIT 1`,
      [notificationId, req.user.id]
    );

    if (!notification) {
      throw new AppError("Bildirishnoma topilmadi.", 404);
    }

    if (!notification.is_read) {
      await pool.query(
        `UPDATE notifications
         SET is_read = 1, read_at = NOW()
         WHERE id = ?`,
        [notificationId]
      );
    }

    return sendOk(res, {
      id: notificationId,
      isRead: true,
    });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const pool = getPool();

    await pool.query(
      `UPDATE notifications
       SET is_read = 1, read_at = NOW()
       WHERE recipient_user_id = ?
         AND is_read = 0`,
      [req.user.id]
    );

    return sendOk(res, {
      isRead: true,
    });
  })
);

export default router;
