import { Router } from "express";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import AppError from "../utils/app-error.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { buildUpdateColumns, fetchOne } from "../utils/db-helpers.js";
import { requireFields, toPositiveInt } from "../utils/validation.js";
import { logActivity } from "../utils/activity.js";
import { sendCreated, sendOk } from "../utils/http.js";

const router = Router();

router.use(authenticate);

router.get(
  "/rootstock-types",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT *
       FROM rootstock_types
       ORDER BY id DESC`
    );

    return sendOk(res, rows);
  })
);

router.post(
  "/rootstock-types",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ["name", "code"]);

    const pool = getPool();
    const [result] = await pool.query(
      "INSERT INTO rootstock_types (name, code, description) VALUES (?, ?, ?)",
      [req.body.name, req.body.code, req.body.description || null]
    );

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "rootstock_type_created",
      entityType: "rootstock_type",
      entityId: result.insertId,
      description: `${req.body.name} payvand turi yaratildi`
    });

    const createdRow = await fetchOne(pool, "SELECT * FROM rootstock_types WHERE id = ?", [result.insertId]);
    return sendCreated(res, createdRow, "Payvand turi yaratildi.");
  })
);

router.put(
  "/rootstock-types/:id",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const rootstockTypeId = toPositiveInt(req.params.id, "rootstockTypeId");
    const existingRow = await fetchOne(pool, "SELECT id FROM rootstock_types WHERE id = ? LIMIT 1", [rootstockTypeId]);

    if (!existingRow) {
      throw new AppError("Payvand turi topilmadi.", 404);
    }

    const updates = buildUpdateColumns({
      name: req.body.name,
      code: req.body.code,
      description: req.body.description
    });

    if (!updates.hasValues) {
      throw new AppError("Yangilash uchun kamida bitta maydon yuboring.", 400);
    }

    await pool.query(`UPDATE rootstock_types SET ${updates.sql} WHERE id = ?`, [...updates.values, rootstockTypeId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "rootstock_type_updated",
      entityType: "rootstock_type",
      entityId: rootstockTypeId,
      description: `Payvand turi #${rootstockTypeId} yangilandi`
    });

    const updatedRow = await fetchOne(pool, "SELECT * FROM rootstock_types WHERE id = ?", [rootstockTypeId]);
    return sendOk(res, updatedRow, "Payvand turi yangilandi.");
  })
);

router.delete(
  "/rootstock-types/:id",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const rootstockTypeId = toPositiveInt(req.params.id, "rootstockTypeId");
    const existingRow = await fetchOne(pool, "SELECT id, name FROM rootstock_types WHERE id = ? LIMIT 1", [rootstockTypeId]);

    if (!existingRow) {
      throw new AppError("Payvand turi topilmadi.", 404);
    }

    await pool.query("DELETE FROM rootstock_types WHERE id = ?", [rootstockTypeId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "rootstock_type_deleted",
      entityType: "rootstock_type",
      entityId: rootstockTypeId,
      description: `${existingRow.name} payvand turi o'chirildi`
    });

    return sendOk(res, null, "Payvand turi o'chirildi.");
  })
);

router.get(
  "/seedling-types",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT st.*,
              COUNT(v.id) AS varieties_count
       FROM seedling_types st
       LEFT JOIN varieties v ON v.seedling_type_id = st.id
       GROUP BY st.id
       ORDER BY CASE WHEN st.name = 'Aniqlanmagan' THEN 0 ELSE 1 END, st.id DESC`
    );

    return sendOk(res, rows);
  })
);

router.post(
  "/seedling-types",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ["name", "code"]);

    const pool = getPool();
    const [result] = await pool.query(
      "INSERT INTO seedling_types (name, code, description) VALUES (?, ?, ?)",
      [req.body.name, req.body.code, req.body.description || null]
    );

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "seedling_type_created",
      entityType: "seedling_type",
      entityId: result.insertId,
      description: `${req.body.name} seedling type yaratildi`
    });

    const createdRow = await fetchOne(pool, "SELECT * FROM seedling_types WHERE id = ?", [result.insertId]);
    return sendCreated(res, createdRow, "Seedling type yaratildi.");
  })
);

router.put(
  "/seedling-types/:id",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const seedlingTypeId = toPositiveInt(req.params.id, "seedlingTypeId");
    const existingRow = await fetchOne(pool, "SELECT id FROM seedling_types WHERE id = ? LIMIT 1", [seedlingTypeId]);

    if (!existingRow) {
      throw new AppError("Seedling type topilmadi.", 404);
    }

    const updates = buildUpdateColumns({
      name: req.body.name,
      code: req.body.code,
      description: req.body.description
    });

    if (!updates.hasValues) {
      throw new AppError("Yangilash uchun kamida bitta maydon yuboring.", 400);
    }

    await pool.query(`UPDATE seedling_types SET ${updates.sql} WHERE id = ?`, [...updates.values, seedlingTypeId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "seedling_type_updated",
      entityType: "seedling_type",
      entityId: seedlingTypeId,
      description: `Seedling type #${seedlingTypeId} yangilandi`
    });

    const updatedRow = await fetchOne(pool, "SELECT * FROM seedling_types WHERE id = ?", [seedlingTypeId]);
    return sendOk(res, updatedRow, "Seedling type yangilandi.");
  })
);

router.delete(
  "/seedling-types/:id",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const seedlingTypeId = toPositiveInt(req.params.id, "seedlingTypeId");
    const existingRow = await fetchOne(pool, "SELECT id, name FROM seedling_types WHERE id = ? LIMIT 1", [seedlingTypeId]);

    if (!existingRow) {
      throw new AppError("Seedling type topilmadi.", 404);
    }

    await pool.query("DELETE FROM seedling_types WHERE id = ?", [seedlingTypeId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "seedling_type_deleted",
      entityType: "seedling_type",
      entityId: seedlingTypeId,
      description: `${existingRow.name} seedling type o'chirildi`
    });

    return sendOk(res, null, "Seedling type o'chirildi.");
  })
);

router.get(
  "/varieties",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const conditions = ["1 = 1"];
    const params = [];

    if (req.query.seedlingTypeId) {
      conditions.push("v.seedling_type_id = ?");
      params.push(req.query.seedlingTypeId);
    }

    const [rows] = await pool.query(
      `SELECT v.*, st.name AS seedling_type_name, st.code AS seedling_type_code
       FROM varieties v
       JOIN seedling_types st ON st.id = v.seedling_type_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY CASE WHEN v.name = 'Aniqlanmagan nav' THEN 0 ELSE 1 END, v.id DESC`,
      params
    );

    return sendOk(res, rows);
  })
);

router.get(
  "/varieties/by-type/:seedlingTypeId",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const seedlingTypeId = toPositiveInt(req.params.seedlingTypeId, "seedlingTypeId");
    const [rows] = await pool.query(
      `SELECT v.*, st.name AS seedling_type_name, st.code AS seedling_type_code
       FROM varieties v
       JOIN seedling_types st ON st.id = v.seedling_type_id
       WHERE v.seedling_type_id = ?
       ORDER BY CASE WHEN v.name = 'Aniqlanmagan nav' THEN 0 ELSE 1 END, v.id DESC`,
      [seedlingTypeId]
    );

    return sendOk(res, rows);
  })
);

router.post(
  "/varieties",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ["seedlingTypeId", "name", "code"]);

    const pool = getPool();
    const seedlingTypeId = toPositiveInt(req.body.seedlingTypeId, "seedlingTypeId");
    const type = await fetchOne(pool, "SELECT id FROM seedling_types WHERE id = ? LIMIT 1", [seedlingTypeId]);

    if (!type) {
      throw new AppError("Seedling type topilmadi.", 404);
    }

    const [result] = await pool.query(
      `INSERT INTO varieties (seedling_type_id, name, code, description)
       VALUES (?, ?, ?, ?)`,
      [seedlingTypeId, req.body.name, req.body.code, req.body.description || null]
    );

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "variety_created",
      entityType: "variety",
      entityId: result.insertId,
      description: `${req.body.name} variety yaratildi`
    });

    const createdRow = await fetchOne(pool, "SELECT * FROM varieties WHERE id = ?", [result.insertId]);
    return sendCreated(res, createdRow, "Variety yaratildi.");
  })
);

router.put(
  "/varieties/:id",
  authorize("admin", "bosh_agranom"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const varietyId = toPositiveInt(req.params.id, "varietyId");
    const existingRow = await fetchOne(pool, "SELECT id FROM varieties WHERE id = ? LIMIT 1", [varietyId]);

    if (!existingRow) {
      throw new AppError("Variety topilmadi.", 404);
    }

    let seedlingTypeId;
    if (req.body.seedlingTypeId !== undefined) {
      seedlingTypeId = toPositiveInt(req.body.seedlingTypeId, "seedlingTypeId");
      const type = await fetchOne(pool, "SELECT id FROM seedling_types WHERE id = ? LIMIT 1", [seedlingTypeId]);

      if (!type) {
        throw new AppError("Seedling type topilmadi.", 404);
      }
    }

    const updates = buildUpdateColumns({
      seedling_type_id: seedlingTypeId,
      name: req.body.name,
      code: req.body.code,
      description: req.body.description
    });

    if (!updates.hasValues) {
      throw new AppError("Yangilash uchun kamida bitta maydon yuboring.", 400);
    }

    await pool.query(`UPDATE varieties SET ${updates.sql} WHERE id = ?`, [...updates.values, varietyId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "variety_updated",
      entityType: "variety",
      entityId: varietyId,
      description: `Variety #${varietyId} yangilandi`
    });

    const updatedRow = await fetchOne(pool, "SELECT * FROM varieties WHERE id = ?", [varietyId]);
    return sendOk(res, updatedRow, "Variety yangilandi.");
  })
);

router.delete(
  "/varieties/:id",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const varietyId = toPositiveInt(req.params.id, "varietyId");
    const existingRow = await fetchOne(pool, "SELECT id, name FROM varieties WHERE id = ? LIMIT 1", [varietyId]);

    if (!existingRow) {
      throw new AppError("Variety topilmadi.", 404);
    }

    await pool.query("DELETE FROM varieties WHERE id = ?", [varietyId]);

    await logActivity(pool, {
      actorUserId: req.user.id,
      action: "variety_deleted",
      entityType: "variety",
      entityId: varietyId,
      description: `${existingRow.name} variety o'chirildi`
    });

    return sendOk(res, null, "Variety o'chirildi.");
  })
);

export default router;
