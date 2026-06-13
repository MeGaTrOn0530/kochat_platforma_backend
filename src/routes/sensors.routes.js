import { Router } from "express";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { sendCreated, sendOk } from "../utils/http.js";
import AppError from "../utils/app-error.js";

const router = Router();

// ─── ESP32 dan kelgan ma'lumotni qabul qilish (API key orqali, JWT shart emas) ─
router.post(
  "/reading",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const { apiKey, temperature, humidity } = req.body;

    if (!apiKey) throw new AppError("API kaliti talab etiladi", 401);
    if (temperature === undefined || temperature === null) throw new AppError("Harorat talab etiladi", 400);

    const temp = parseFloat(temperature);
    if (isNaN(temp) || temp < -50 || temp > 100) {
      throw new AppError("Harorat noto'g'ri (-50 dan 100 gacha)", 400);
    }

    const [deviceRows] = await pool.query(
      `SELECT id, location_id FROM sensor_devices WHERE api_key = ? AND is_active = 1 LIMIT 1`,
      [apiKey]
    );

    if (!deviceRows.length) throw new AppError("Qurilma topilmadi yoki faol emas", 404);

    const device = deviceRows[0];

    await pool.query(
      `INSERT INTO temperature_readings (device_id, location_id, temperature, humidity, recorded_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [device.id, device.location_id, temp, humidity != null ? parseFloat(humidity) || null : null]
    );

    await pool.query(
      `UPDATE sensor_devices SET last_seen_at = NOW() WHERE id = ?`,
      [device.id]
    );

    return sendCreated(res, { ok: true });
  })
);

// ─── Quyidagi endpointlar JWT talab qiladi ────────────────────────────────────
router.use(authenticate);

// ─── Qurilmalarni boshqarish (admin only) ─────────────────────────────────────

// Barcha qurilmalar ro'yxati
router.get(
  "/devices",
  authorize("admin", "bosh_agranom", "bosh_ofes"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT sd.*, l.name AS location_name
       FROM sensor_devices sd
       JOIN locations l ON l.id = sd.location_id
       ORDER BY l.name, sd.device_code`
    );
    return sendOk(res, rows);
  })
);

// Yangi qurilma qo'shish
router.post(
  "/devices",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const { locationId, deviceCode, label } = req.body;

    if (!locationId || !deviceCode) throw new AppError("locationId va deviceCode talab etiladi", 400);

    // Tasodifiy API key yaratish
    const apiKey = "sk_" + Array.from(
      { length: 40 },
      () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]
    ).join("");

    const [result] = await pool.query(
      `INSERT INTO sensor_devices (location_id, device_code, api_key, label, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [locationId, deviceCode.trim(), apiKey, label?.trim() || null]
    );

    return sendCreated(res, { id: result.insertId, apiKey, deviceCode, locationId });
  })
);

// Qurilmani o'chirish / faolsizlashtirish
router.delete(
  "/devices/:id",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    await pool.query(`UPDATE sensor_devices SET is_active = 0 WHERE id = ?`, [req.params.id]);
    return sendOk(res, { ok: true });
  })
);

// ─── Harorat ma'lumotlari (bosh_agranom + admin) ──────────────────────────────

// Har bir teplitsaning JORIY (oxirgi) harorati
router.get(
  "/live",
  authorize("admin", "bosh_agranom", "bosh_ofes"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT
         l.id   AS location_id,
         l.name AS location_name,
         l.type AS location_type,
         tr.temperature,
         tr.humidity,
         tr.recorded_at,
         sd.device_code,
         sd.last_seen_at,
         TIMESTAMPDIFF(MINUTE, tr.recorded_at, NOW()) AS minutes_ago
       FROM locations l
       LEFT JOIN sensor_devices sd ON sd.location_id = l.id AND sd.is_active = 1
       LEFT JOIN temperature_readings tr ON tr.id = (
         SELECT id FROM temperature_readings
         WHERE location_id = l.id
         ORDER BY recorded_at DESC
         LIMIT 1
       )
       WHERE l.status = 'active'
       ORDER BY l.name`
    );
    return sendOk(res, rows);
  })
);

// Kunlik statistika: max, min, o'rtacha va ularning vaqti
router.get(
  "/daily",
  authorize("admin", "bosh_agranom", "bosh_ofes"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const locationId = req.query.locationId ? Number(req.query.locationId) : null;

    const conditions = ["DATE(tr.recorded_at) = ?"];
    const params = [date];

    if (locationId) {
      conditions.push("tr.location_id = ?");
      params.push(locationId);
    }

    const where = conditions.join(" AND ");

    // Per-location daily stats
    const [stats] = await pool.query(
      `SELECT
         tr.location_id,
         l.name AS location_name,
         ROUND(MAX(tr.temperature), 1) AS max_temp,
         ROUND(MIN(tr.temperature), 1) AS min_temp,
         ROUND(AVG(tr.temperature), 1) AS avg_temp,
         ROUND(AVG(tr.humidity), 1)    AS avg_humidity,
         COUNT(*) AS reading_count
       FROM temperature_readings tr
       JOIN locations l ON l.id = tr.location_id
       WHERE ${where}
       GROUP BY tr.location_id, l.name
       ORDER BY l.name`,
      params
    );

    // Max va min vaqtlarini alohida topish
    const enriched = await Promise.all(
      stats.map(async (row) => {
        const locParams = [date, row.location_id, row.max_temp];
        const [maxRow] = await pool.query(
          `SELECT TIME_FORMAT(recorded_at, '%H:%i') AS at_time
           FROM temperature_readings
           WHERE DATE(recorded_at) = ? AND location_id = ? AND temperature = ?
           ORDER BY recorded_at ASC LIMIT 1`,
          locParams
        );
        const [minRow] = await pool.query(
          `SELECT TIME_FORMAT(recorded_at, '%H:%i') AS at_time
           FROM temperature_readings
           WHERE DATE(recorded_at) = ? AND location_id = ? AND temperature = ?
           ORDER BY recorded_at ASC LIMIT 1`,
          [date, row.location_id, row.min_temp]
        );
        return {
          ...row,
          max_at: maxRow[0]?.at_time || null,
          min_at: minRow[0]?.at_time || null,
        };
      })
    );

    return sendOk(res, { date, stats: enriched });
  })
);

// Soatlik grafik ma'lumotlari (1 kun, 1 lokatsiya)
router.get(
  "/history",
  authorize("admin", "bosh_agranom", "bosh_ofes"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const locationId = req.query.locationId ? Number(req.query.locationId) : null;

    if (!locationId) throw new AppError("locationId talab etiladi", 400);

    // Har 10 daqiqada bir nuqta (bugungi kun uchun ~144 nuqta)
    const [rows] = await pool.query(
      `SELECT
         DATE_FORMAT(recorded_at, '%H:%i') AS time_label,
         FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(recorded_at) / 600) * 600) AS bucket_time,
         ROUND(AVG(temperature), 1) AS temperature,
         ROUND(AVG(humidity), 1)    AS humidity
       FROM temperature_readings
       WHERE DATE(recorded_at) = ? AND location_id = ?
       GROUP BY bucket_time
       ORDER BY bucket_time ASC`,
      [date, locationId]
    );

    return sendOk(res, { date, locationId, points: rows });
  })
);

// Ko'p kunlik tarix (oxirgi 30 kun)
router.get(
  "/history-multi",
  authorize("admin", "bosh_agranom", "bosh_ofes"),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const days = Math.min(Number(req.query.days || 30), 90);
    const locationId = req.query.locationId ? Number(req.query.locationId) : null;

    const conditions = ["recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"];
    const params = [days];

    if (locationId) {
      conditions.push("location_id = ?");
      params.push(locationId);
    }

    const [rows] = await pool.query(
      `SELECT
         DATE(recorded_at)            AS day,
         location_id,
         ROUND(MAX(temperature), 1)  AS max_temp,
         ROUND(MIN(temperature), 1)  AS min_temp,
         ROUND(AVG(temperature), 1)  AS avg_temp
       FROM temperature_readings
       WHERE ${conditions.join(" AND ")}
       GROUP BY day, location_id
       ORDER BY day DESC, location_id`,
      params
    );

    return sendOk(res, rows);
  })
);

export default router;
