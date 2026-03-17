import { Router } from "express";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import AppError from "../utils/app-error.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { buildUpdateColumns, fetchOne } from "../utils/db-helpers.js";
import { requireFields } from "../utils/validation.js";
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

    if (req.user.role === "agranom") {
      if (!req.user.locationId) {
        return sendOk(res, []);
      }

      conditions.push("l.id = ?");
      params.push(req.user.locationId);
    }

    if (req.query.status) {
      conditions.push("l.status = ?");
      params.push(req.query.status);
    }

    if (req.query.type) {
      conditions.push("l.type = ?");
      params.push(req.query.type);
    }

    if (req.query.search) {
      const pattern = `%${req.query.search}%`;
      conditions.push("(l.name LIKE ? OR l.code LIKE ? OR l.region LIKE ?)");
      params.push(pattern, pattern, pattern);
    }

    const [rows] = await pool.query(
      `SELECT l.*,
              COALESCE(inv.total_stock, 0) AS total_stock,
              COALESCE(inv.total_defects, 0) AS total_defects
       FROM locations l
       LEFT JOIN (
         SELECT location_id, SUM(quantity_available) AS total_stock, SUM(defect_quantity) AS total_defects
         FROM seedling_inventory
         GROUP BY location_id
       ) inv ON inv.location_id = l.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY l.id DESC`,
      params
    );

    return sendOk(res, rows);
  })
);

router.post(
  "/",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ["name", "code"]);

    const pool = getPool();
    const [result] = await pool.query(
      `INSERT INTO locations (name, code, type, capacity, description, region, address, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.body.name,
        req.body.code,
        req.body.type || "greenhouse",
        Number.parseInt(req.body.capacity, 10) || 0,
        req.body.description || null,
        req.body.region || null,
        req.body.address || null,
        req.body.status || "active"
      ]
    );

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "location_created",
      entityType: "location",
      entityId: result.insertId,
      description: `${req.body.name} lokatsiyasi yaratildi`
    });

    const createdLocation = await fetchOne(pool, "SELECT * FROM locations WHERE id = ?", [result.insertId]);
    return sendCreated(res, createdLocation, "Lokatsiya yaratildi.");
  })
);

router.put(
  "/:id",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const locationId = Number.parseInt(req.params.id, 10);
    const existingLocation = await fetchOne(pool, "SELECT id FROM locations WHERE id = ? LIMIT 1", [locationId]);

    if (!existingLocation) {
      throw new AppError("Lokatsiya topilmadi.", 404);
    }

    const updates = buildUpdateColumns({
      name: req.body.name,
      code: req.body.code,
      type: req.body.type,
      capacity: req.body.capacity !== undefined ? Number.parseInt(req.body.capacity, 10) || 0 : undefined,
      description: req.body.description,
      region: req.body.region,
      address: req.body.address,
      status: req.body.status
    });

    if (!updates.hasValues) {
      throw new AppError("Yangilash uchun kamida bitta maydon yuboring.", 400);
    }

    await pool.query(`UPDATE locations SET ${updates.sql} WHERE id = ?`, [...updates.values, locationId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "location_updated",
      entityType: "location",
      entityId: locationId,
      description: `Lokatsiya #${locationId} yangilandi`
    });

    const updatedLocation = await fetchOne(pool, "SELECT * FROM locations WHERE id = ?", [locationId]);
    return sendOk(res, updatedLocation, "Lokatsiya yangilandi.");
  })
);

router.delete(
  "/:id",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const locationId = Number.parseInt(req.params.id, 10);
    const existingLocation = await fetchOne(
      pool,
      "SELECT id, name FROM locations WHERE id = ? LIMIT 1",
      [locationId]
    );

    if (!existingLocation) {
      throw new AppError("Lokatsiya topilmadi.", 404);
    }

    const dependencyChecks = [
      { sql: "SELECT COUNT(*) AS total FROM users WHERE location_id = ?", label: "foydalanuvchilar" },
      { sql: "SELECT COUNT(*) AS total FROM seedling_inventory WHERE location_id = ?", label: "inventar yozuvlari" },
      {
        sql: "SELECT COUNT(*) AS total FROM seedling_batches WHERE location_id = ? OR source_location_id = ?",
        params: [locationId, locationId],
        label: "partiyalar",
      },
      {
        sql: "SELECT COUNT(*) AS total FROM transfers WHERE from_location_id = ? OR to_location_id = ?",
        params: [locationId, locationId],
        label: "transferlar",
      },
      { sql: "SELECT COUNT(*) AS total FROM orders WHERE location_id = ?", label: "buyurtmalar" },
      { sql: "SELECT COUNT(*) AS total FROM tasks WHERE location_id = ?", label: "topshiriqlar" },
    ];

    for (const check of dependencyChecks) {
      const [rows] = await pool.query(check.sql, check.params || [locationId]);
      if (Number(rows[0]?.total || 0) > 0) {
        throw new AppError(
          `${existingLocation.name} lokatsiyasiga bog'langan ${check.label} mavjud. Avval ularni tozalang.`,
          400
        );
      }
    }

    await pool.query("DELETE FROM locations WHERE id = ?", [locationId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "location_deleted",
      entityType: "location",
      entityId: locationId,
      description: `${existingLocation.name} lokatsiyasi o'chirildi`,
    });

    return sendOk(res, null, "Lokatsiya o'chirildi.");
  })
);

export default router;
