/**
 * modules.routes.js
 * Barcha yangi modullar uchun API: Moliya, CRM, Yetkazish, Agro, HR, Telegram, Sertifikat
 */
import { Router } from "express";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { sendOk, sendCreated } from "../utils/http.js";
import AppError from "../utils/app-error.js";

const router = Router();
router.use(authenticate);

// ─────────────────────────────────────────────
// 1. MOLIYAVIY TIZIM — To'lovlar
// ─────────────────────────────────────────────
router.get("/payments", authorize("admin", "bugalter"), asyncHandler(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT p.*, o.order_number, o.customer_name, o.total_amount,
            u.full_name AS created_by_name
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     LEFT JOIN users u ON u.id = p.created_by
     ORDER BY p.payment_date DESC
     LIMIT 200`
  );
  return sendOk(res, rows);
}));

router.post("/payments", authorize("admin", "bugalter"), asyncHandler(async (req, res) => {
  const pool = getPool();
  const { orderId, amount, paymentMethod = "cash", paymentDate, note } = req.body;
  if (!orderId || !amount) throw new AppError("orderId va amount majburiy", 400);

  const [result] = await pool.query(
    `INSERT INTO payments (order_id, amount, payment_method, payment_date, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [orderId, amount, paymentMethod, paymentDate || new Date(), note || null, req.user.id]
  );

  // Buyurtmaga to'lov summasi yangilash
  await pool.query(
    `UPDATE orders SET updated_at = NOW() WHERE id = ?`, [orderId]
  );

  return sendCreated(res, { id: result.insertId }, "To'lov qo'shildi");
}));

router.delete("/payments/:id", authorize("admin"), asyncHandler(async (req, res) => {
  const pool = getPool();
  await pool.query("DELETE FROM payments WHERE id = ?", [req.params.id]);
  return sendOk(res, null, "To'lov o'chirildi");
}));

// To'lov summasi per order
router.get("/payments/by-order/:orderId", asyncHandler(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT p.*, u.full_name AS created_by_name
     FROM payments p
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.order_id = ?
     ORDER BY p.payment_date DESC`,
    [req.params.orderId]
  );
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return sendOk(res, { payments: rows, totalPaid: total });
}));

// ─────────────────────────────────────────────
// 2. CRM — Mijozlar bazasi
// ─────────────────────────────────────────────
router.get("/customers", asyncHandler(async (req, res) => {
  const pool = getPool();
  const search = req.query.search ? `%${req.query.search}%` : null;
  const whereClause = search ? "WHERE (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)" : "";
  const params = search ? [search, search, search] : [];

  const [rows] = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_name COLLATE utf8mb4_unicode_ci = c.name) AS order_count,
       (SELECT COALESCE(SUM(o.total_amount),0) FROM orders o WHERE o.customer_name COLLATE utf8mb4_unicode_ci = c.name AND o.status='completed') AS total_spent
     FROM customers c ${whereClause}
     ORDER BY c.name ASC
     LIMIT 200`,
    params
  );
  return sendOk(res, rows);
}));

router.post("/customers", authorize("admin", "bugalter"), asyncHandler(async (req, res) => {
  const pool = getPool();
  const { name, phone, phone2, email, address, notes } = req.body;
  if (!name) throw new AppError("Mijoz ismi majburiy", 400);

  const [result] = await pool.query(
    `INSERT INTO customers (name, phone, phone2, email, address, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, phone || null, phone2 || null, email || null, address || null, notes || null, req.user.id]
  );
  return sendCreated(res, { id: result.insertId }, "Mijoz qo'shildi");
}));

router.put("/customers/:id", authorize("admin", "bugalter"), asyncHandler(async (req, res) => {
  const pool = getPool();
  const { name, phone, phone2, email, address, notes, isActive } = req.body;
  await pool.query(
    `UPDATE customers SET name=?, phone=?, phone2=?, email=?, address=?, notes=?,
     is_active=?, updated_at=NOW() WHERE id=?`,
    [name, phone || null, phone2 || null, email || null, address || null, notes || null,
     isActive !== undefined ? isActive : 1, req.params.id]
  );
  return sendOk(res, null, "Mijoz yangilandi");
}));

router.delete("/customers/:id", authorize("admin"), asyncHandler(async (req, res) => {
  const pool = getPool();
  await pool.query("DELETE FROM customers WHERE id = ?", [req.params.id]);
  return sendOk(res, null, "Mijoz o'chirildi");
}));

// ─────────────────────────────────────────────
// 3. YETKAZIB BERISH
// ─────────────────────────────────────────────
router.get("/deliveries", asyncHandler(async (req, res) => {
  const pool = getPool();
  const status = req.query.status;
  const whereClause = status ? "WHERE d.status = ?" : "";
  const params = status ? [status] : [];

  const [rows] = await pool.query(
    `SELECT d.*, o.order_number
     FROM deliveries d
     LEFT JOIN orders o ON o.id = d.order_id
     ${whereClause}
     ORDER BY d.delivery_date ASC
     LIMIT 200`,
    params
  );
  return sendOk(res, rows);
}));

router.post("/deliveries", authorize("admin", "bugalter"), asyncHandler(async (req, res) => {
  const pool = getPool();
  const { orderId, customerId, customerName, address, quantity, deliveryDate,
          deliveryTime, driverName, driverPhone, vehicle, note } = req.body;
  if (!customerName || !address || !deliveryDate) {
    throw new AppError("Mijoz nomi, manzil va sana majburiy", 400);
  }
  const [result] = await pool.query(
    `INSERT INTO deliveries
      (order_id, customer_id, customer_name, address, quantity, delivery_date,
       delivery_time, driver_name, driver_phone, vehicle, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderId || null, customerId || null, customerName, address, quantity || 0,
     deliveryDate, deliveryTime || null, driverName || null, driverPhone || null,
     vehicle || null, note || null, req.user.id]
  );
  return sendCreated(res, { id: result.insertId }, "Yetkazib berish qo'shildi");
}));

router.put("/deliveries/:id/status", asyncHandler(async (req, res) => {
  const pool = getPool();
  const { status } = req.body;
  await pool.query(
    "UPDATE deliveries SET status=?, updated_at=NOW() WHERE id=?",
    [status, req.params.id]
  );
  return sendOk(res, null, "Holat yangilandi");
}));

router.delete("/deliveries/:id", authorize("admin"), asyncHandler(async (req, res) => {
  const pool = getPool();
  await pool.query("DELETE FROM deliveries WHERE id = ?", [req.params.id]);
  return sendOk(res, null, "O'chirildi");
}));

// ─────────────────────────────────────────────
// 4. AGROTEXNIK JURNALI
// ─────────────────────────────────────────────
router.get("/agro-journal", asyncHandler(async (req, res) => {
  const pool = getPool();
  const conds = [];
  const params = [];
  if (req.query.locationId) { conds.push("a.location_id = ?"); params.push(req.query.locationId); }
  if (req.query.actionType)  { conds.push("a.action_type = ?"); params.push(req.query.actionType); }
  if (req.query.dateFrom)    { conds.push("DATE(a.action_date) >= ?"); params.push(req.query.dateFrom); }
  if (req.query.dateTo)      { conds.push("DATE(a.action_date) <= ?"); params.push(req.query.dateTo); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `SELECT a.*, l.name AS location_name, b.batch_code,
            u.full_name AS performed_by_name
     FROM agro_journal a
     LEFT JOIN locations l ON l.id = a.location_id
     LEFT JOIN seedling_batches b ON b.id = a.batch_id
     LEFT JOIN users u ON u.id = a.performed_by
     ${where}
     ORDER BY a.action_date DESC
     LIMIT 300`,
    params
  );
  return sendOk(res, rows);
}));

router.post("/agro-journal", asyncHandler(async (req, res) => {
  const pool = getPool();
  const { locationId, batchId, actionType, actionDate, quantityUsed, unit,
          productName, description } = req.body;
  if (!actionType) throw new AppError("Harakat turi majburiy", 400);

  const [result] = await pool.query(
    `INSERT INTO agro_journal
      (location_id, batch_id, action_type, action_date, quantity_used, unit,
       product_name, description, performed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [locationId || null, batchId || null, actionType,
     actionDate || new Date(), quantityUsed || null, unit || null,
     productName || null, description || null, req.user.id]
  );
  return sendCreated(res, { id: result.insertId }, "Jurnal yozuvi qo'shildi");
}));

router.delete("/agro-journal/:id", authorize("admin", "bosh_agranom"), asyncHandler(async (req, res) => {
  const pool = getPool();
  await pool.query("DELETE FROM agro_journal WHERE id = ?", [req.params.id]);
  return sendOk(res, null, "O'chirildi");
}));

// ─────────────────────────────────────────────
// 5. HR — DAVOMAT
// ─────────────────────────────────────────────
router.get("/attendance", authorize("admin"), asyncHandler(async (req, res) => {
  const pool = getPool();
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const [rows] = await pool.query(
    `SELECT a.*, u.full_name, u.username,
            (SELECT name FROM locations WHERE id = u.location_id LIMIT 1) AS location_name
     FROM attendance a
     JOIN users u ON u.id = a.user_id
     WHERE a.work_date = ?
     ORDER BY u.full_name`,
    [date]
  );
  return sendOk(res, rows);
}));

router.post("/attendance", authorize("admin"), asyncHandler(async (req, res) => {
  const pool = getPool();
  const { userId, workDate, checkIn, checkOut, status, note } = req.body;
  if (!userId || !workDate) throw new AppError("userId va workDate majburiy", 400);

  await pool.query(
    `INSERT INTO attendance (user_id, work_date, check_in, check_out, status, note, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE check_in=VALUES(check_in), check_out=VALUES(check_out),
     status=VALUES(status), note=VALUES(note), recorded_by=VALUES(recorded_by)`,
    [userId, workDate, checkIn || null, checkOut || null,
     status || "present", note || null, req.user.id]
  );
  return sendOk(res, null, "Davomat saqlandi");
}));

// HR — TOPSHIRIQLAR
router.get("/tasks", asyncHandler(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT t.*,
            u.full_name AS assigned_to_name,
            b.full_name AS assigned_by_name,
            l.name AS location_name
     FROM employee_tasks t
     LEFT JOIN users u ON u.id = t.assigned_to
     LEFT JOIN users b ON b.id = t.assigned_by
     LEFT JOIN locations l ON l.id = t.location_id
     ORDER BY FIELD(t.status,'pending','in_progress','done'), t.due_date ASC
     LIMIT 200`
  );
  return sendOk(res, rows);
}));

router.post("/tasks", asyncHandler(async (req, res) => {
  const pool = getPool();
  const { title, description, assignedTo, locationId, priority, dueDate } = req.body;
  if (!title) throw new AppError("Sarlavha majburiy", 400);
  const [result] = await pool.query(
    `INSERT INTO employee_tasks (title, description, assigned_to, assigned_by, location_id, priority, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title, description || null, assignedTo || null, req.user.id,
     locationId || null, priority || "normal", dueDate || null]
  );
  return sendCreated(res, { id: result.insertId }, "Topshiriq yaratildi");
}));

router.put("/tasks/:id/status", asyncHandler(async (req, res) => {
  const pool = getPool();
  const { status } = req.body;
  const completedAt = status === "done" ? new Date() : null;
  await pool.query(
    "UPDATE employee_tasks SET status=?, completed_at=?, updated_at=NOW() WHERE id=?",
    [status, completedAt, req.params.id]
  );
  return sendOk(res, null, "Status yangilandi");
}));

router.delete("/tasks/:id", authorize("admin"), asyncHandler(async (req, res) => {
  const pool = getPool();
  await pool.query("DELETE FROM employee_tasks WHERE id = ?", [req.params.id]);
  return sendOk(res, null, "O'chirildi");
}));

// ─────────────────────────────────────────────
// 6. TELEGRAM BOT SOZLAMALARI
// ─────────────────────────────────────────────
router.get("/telegram/settings", asyncHandler(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT * FROM telegram_settings WHERE user_id = ? LIMIT 1",
    [req.user.id]
  );
  return sendOk(res, rows[0] || null);
}));

router.post("/telegram/settings", asyncHandler(async (req, res) => {
  const pool = getPool();
  const { telegramChatId, telegramUsername, notifyNewOrder, notifyOrderSold,
          notifyTransfer, notifyLowStock } = req.body;
  await pool.query(
    `INSERT INTO telegram_settings
      (user_id, telegram_chat_id, telegram_username, notify_new_order,
       notify_order_sold, notify_transfer, notify_low_stock)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       telegram_chat_id=VALUES(telegram_chat_id),
       telegram_username=VALUES(telegram_username),
       notify_new_order=VALUES(notify_new_order),
       notify_order_sold=VALUES(notify_order_sold),
       notify_transfer=VALUES(notify_transfer),
       notify_low_stock=VALUES(notify_low_stock),
       updated_at=NOW()`,
    [req.user.id, telegramChatId || null, telegramUsername || null,
     notifyNewOrder ? 1 : 0, notifyOrderSold ? 1 : 0,
     notifyTransfer ? 1 : 0, notifyLowStock ? 1 : 0]
  );
  return sendOk(res, null, "Telegram sozlamalari saqlandi");
}));

// ─────────────────────────────────────────────
// 7. SIFAT SERTIFIKATLARI
// ─────────────────────────────────────────────
router.get("/certificates", asyncHandler(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT c.*,
            u.full_name AS issued_by_name
     FROM certificates c
     LEFT JOIN users u ON u.id = c.issued_by
     ORDER BY c.created_at DESC
     LIMIT 200`
  );
  return sendOk(res, rows);
}));

router.post("/certificates", authorize("admin", "bosh_agranom"), asyncHandler(async (req, res) => {
  const pool = getPool();
  const { batchId, orderId, certType, issuedTo, issueDate, expiryDate,
          seedlingType, varietyName, quantity, locationName, notes } = req.body;
  if (!issuedTo || !issueDate) throw new AppError("Kimga berildi va sana majburiy", 400);

  const certNumber = `CERT-${Date.now().toString(36).toUpperCase()}`;

  // Batch ma'lumotlarini olish (agar batch tanlangan bo'lsa)
  let bData = {};
  if (batchId) {
    const [bRows] = await pool.query(
      `SELECT b.batch_code, st.name AS st_name, v.name AS v_name, l.name AS l_name
       FROM seedling_batches b
       LEFT JOIN seedling_types st ON st.id = b.seedling_type_id
       LEFT JOIN varieties v ON v.id = b.variety_id
       LEFT JOIN seedling_inventory si ON si.batch_id = b.id
       LEFT JOIN locations l ON l.id = si.location_id
       WHERE b.id = ? LIMIT 1`,
      [batchId]
    );
    if (bRows[0]) bData = bRows[0];
  }

  const [result] = await pool.query(
    `INSERT INTO certificates
      (certificate_number, batch_id, order_id, cert_type, issued_to, issued_by,
       issue_date, expiry_date, seedling_type, variety_name, quantity, location_name, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [certNumber, batchId || null, orderId || null, certType || "quality",
     issuedTo, req.user.id, issueDate, expiryDate || null,
     seedlingType || bData.st_name || null,
     varietyName || bData.v_name || null,
     quantity || 0, locationName || bData.l_name || null, notes || null]
  );

  return sendCreated(res, { id: result.insertId, certNumber }, "Sertifikat yaratildi");
}));

router.put("/certificates/:id/status", authorize("admin"), asyncHandler(async (req, res) => {
  const pool = getPool();
  await pool.query(
    "UPDATE certificates SET status=? WHERE id=?",
    [req.body.status, req.params.id]
  );
  return sendOk(res, null, "Yangilandi");
}));

export default router;
