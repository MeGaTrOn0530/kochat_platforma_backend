/**
 * reset.routes.js — Faqat admin: tanlangan ma'lumotlarni tozalash.
 * keepUsers, keepLocations, keepCatalog opsiyalari bilan nimani saqlashni belgilash mumkin.
 */
import { Router } from "express";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { sendOk } from "../utils/http.js";

const router = Router();
router.use(authenticate);
router.use(authorize("admin"));

router.post(
  "/data",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const conn = await pool.getConnection();

    const keepUsers     = Boolean(req.body.keepUsers);
    const keepLocations = Boolean(req.body.keepLocations);
    const keepCatalog   = Boolean(req.body.keepCatalog);

    try {
      await conn.query("SET FOREIGN_KEY_CHECKS = 0");

      // Har doim o'chiriladigan jadvallar
      const alwaysClear = [
        "greenhouse_variety_stock",
        "greenhouse_stage_log",
        "greenhouse_stage_stock",
        "seedling_scan_events",
        "seedling_units",
        "seedling_history",
        "seedling_inventory",
        "seedling_batches",
        "order_items",
        "orders",
        "transfers",
        "tasks",
        "employee_tasks",
        "attendance",
        "notifications",
        "activity_logs",
        "agro_journal",
        "deliveries",
        "customers",
        "payments",
        "customer_products",
        "certificates",
        "telegram_settings",
        "auth_sessions",
      ];

      // Shartli jadvallar
      const conditionalTables = [
        ...(!keepUsers     ? ["users"]                                               : []),
        ...(!keepLocations ? ["locations"]                                            : []),
        ...(!keepCatalog   ? ["varieties", "seedling_types", "rootstock_types"]      : []),
      ];

      const tables = [...alwaysClear, ...conditionalTables];
      const cleared = [];

      for (const table of tables) {
        try {
          const [check] = await conn.query(
            `SELECT 1 FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
            [table]
          );
          if (check.length > 0) {
            await conn.query(`DELETE FROM \`${table}\``);
            try {
              await conn.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`);
            } catch (_) {}
            cleared.push(table);
          }
        } catch (err) {
          console.warn(`[reset] ${table} o'chirishda xato:`, err.message);
        }
      }

      await conn.query("SET FOREIGN_KEY_CHECKS = 1");

      return sendOk(
        res,
        { cleared, count: cleared.length, keepUsers, keepLocations, keepCatalog },
        "Baza tozalandi! Serverni restart qiling — admin va default lokatsiya qayta yaratiladi."
      );
    } finally {
      conn.release();
    }
  })
);

export default router;
