import { Router } from "express";
import { getPool, withTransaction } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import AppError from "../utils/app-error.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { fetchOne } from "../utils/db-helpers.js";
import { requireFields, toNumber, toPositiveInt } from "../utils/validation.js";
import { logActivity } from "../utils/activity.js";
import { sendCreated, sendOk } from "../utils/http.js";
import { generateCode } from "../utils/code-generator.js";
import {
  createNotifications,
  getNotificationRecipientIds,
  getOrderNotificationRecipientIds
} from "../utils/notifications.js";
import {
  assertEnoughStock,
  ensureLocationExists,
  ensureUnknownCatalog,
  getInventoryById
} from "../utils/inventory.js";

const router = Router();

router.use(authenticate);

async function resolveExistingId(conn, tableName, id) {
  if (!id) return null;
  const row = await fetchOne(conn, `SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`, [id]);
  return row?.id || null;
}

async function tableExists(conn, tableName) {
  const row = await fetchOne(
    conn,
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?
     LIMIT 1`,
    [tableName]
  );

  return Boolean(row);
}

async function resolveOrderVarietyId(conn, seedlingTypeId, varietyId) {
  if (!seedlingTypeId || !varietyId) {
    if (!seedlingTypeId || !(await tableExists(conn, "fruit_varieties"))) {
      return null;
    }

    const fallbackLegacyRow = await fetchOne(
      conn,
      `SELECT id
       FROM fruit_varieties
       WHERE seedling_type_id = ?
       ORDER BY id ASC
       LIMIT 1`,
      [seedlingTypeId]
    );

    return fallbackLegacyRow?.id || null;
  }

  if (!(await tableExists(conn, "fruit_varieties"))) {
    return null;
  }

  const exactLegacyId = await resolveExistingId(conn, "fruit_varieties", varietyId);
  if (exactLegacyId) {
    return exactLegacyId;
  }

  const sourceVariety = await fetchOne(
    conn,
    `SELECT id, seedling_type_id, name, description
     FROM varieties
     WHERE id = ?
     LIMIT 1`,
    [varietyId]
  );

  if (!sourceVariety) {
    return null;
  }

  const matchedLegacyRow = await fetchOne(
    conn,
    `SELECT id
     FROM fruit_varieties
     WHERE seedling_type_id = ?
       AND LOWER(TRIM(name)) = LOWER(TRIM(?))
     LIMIT 1`,
    [seedlingTypeId, sourceVariety.name]
  );

  if (matchedLegacyRow?.id) {
    return matchedLegacyRow.id;
  }

  const [insertResult] = await conn.query(
    `INSERT INTO fruit_varieties
      (seedling_type_id, name, description, created_at, updated_at)
     VALUES (?, ?, ?, NOW(), NOW())`,
    [seedlingTypeId, sourceVariety.name, sourceVariety.description || null]
  );

  return insertResult.insertId;
}

async function resolveOrderSeedlingTypeId(conn, rawSeedlingTypeId, rawVarietyId) {
  const directSeedlingTypeId = await resolveExistingId(conn, "seedling_types", rawSeedlingTypeId || null);
  if (directSeedlingTypeId) {
    return directSeedlingTypeId;
  }

  if (rawVarietyId) {
    const sourceVariety = await fetchOne(
      conn,
      `SELECT seedling_type_id
       FROM varieties
       WHERE id = ?
       LIMIT 1`,
      [rawVarietyId]
    );

    const derivedSeedlingTypeId = await resolveExistingId(
      conn,
      "seedling_types",
      sourceVariety?.seedling_type_id || null
    );

    if (derivedSeedlingTypeId) {
      return derivedSeedlingTypeId;
    }
  }

  const unknownCatalog = await ensureUnknownCatalog(conn);
  return unknownCatalog.seedlingTypeId;
}

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

      conditions.push("o.location_id = ?");
      params.push(req.user.locationId);
    }

    if (req.query.status) {
      conditions.push("o.status = ?");
      params.push(req.query.status);
    }

    if (req.query.locationId) {
      conditions.push("o.location_id = ?");
      params.push(req.query.locationId);
    }

    if (req.query.search) {
      const pattern = `%${req.query.search}%`;
      conditions.push("(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.client_name LIKE ? OR o.customer_phone LIKE ?)");
      params.push(pattern, pattern, pattern, pattern);
    }

    const [rows] = await pool.query(
      `SELECT o.*, l.name AS location_name, cu.full_name AS created_by_name, su.full_name AS sold_by_name,
              COUNT(DISTINCT oi.id) AS items_count,
              GROUP_CONCAT(DISTINCT b.batch_code ORDER BY b.batch_code SEPARATOR ', ') AS batch_codes
       FROM orders o
       JOIN locations l ON l.id = o.location_id
       LEFT JOIN users cu ON cu.id = o.created_by
       LEFT JOIN users su ON su.id = o.sold_by
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN seedling_batches b ON b.id = oi.batch_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY o.id
       ORDER BY o.id DESC`,
      params
    );

    return sendOk(res, rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const orderId = toPositiveInt(req.params.id, "orderId");

    const order = await fetchOne(
      pool,
      `SELECT o.*, l.name AS location_name, cu.full_name AS created_by_name, su.full_name AS sold_by_name
       FROM orders o
       JOIN locations l ON l.id = o.location_id
       LEFT JOIN users cu ON cu.id = o.created_by
       LEFT JOIN users su ON su.id = o.sold_by
       WHERE o.id = ?
       LIMIT 1`,
      [orderId]
    );

    if (!order) {
      throw new AppError("Order topilmadi.", 404);
    }

    const [items] = await pool.query(
      `SELECT oi.*, b.batch_code, st.name AS seedling_type_name, v.name AS variety_name
       FROM order_items oi
       JOIN seedling_batches b ON b.id = oi.batch_id
       LEFT JOIN seedling_types st ON st.id = b.seedling_type_id
       LEFT JOIN varieties v ON v.id = b.variety_id
       WHERE oi.order_id = ?
       ORDER BY oi.id ASC`,
      [orderId]
    );

    return sendOk(res, { order, items });
  })
);

router.post(
  "/",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ["customerName", "locationId", "items"]);

    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      throw new AppError("items bo'sh bo'lmasligi kerak.", 400);
    }

    const result = await withTransaction(async (conn) => {
      const locationId = toPositiveInt(req.body.locationId, "locationId");
      const orderDate = req.body.orderDate ? new Date(req.body.orderDate) : new Date();

      if (Number.isNaN(orderDate.getTime())) {
        throw new AppError("Buyurtma vaqti noto'g'ri yuborildi.", 400);
      }

      await ensureLocationExists(conn, locationId);
      const unknownCatalog = await ensureUnknownCatalog(conn);

      let totalQuantity = 0;
      let totalAmount = 0;
      const parsedItems = [];

      for (const item of req.body.items) {
        requireFields(item, ["batchId", "quantity"]);

        const batchId = toPositiveInt(item.batchId, "batchId");
        const quantity = toPositiveInt(item.quantity, "quantity");
        const unitPrice = toNumber(item.unitPrice, "unitPrice", 0);

        const inventory = await fetchOne(
          conn,
          `SELECT si.*, b.batch_code, b.seedling_type_id, b.variety_id
           FROM seedling_inventory si
           JOIN seedling_batches b ON b.id = si.batch_id
           WHERE si.batch_id = ? AND si.location_id = ?
           LIMIT 1`,
          [batchId, locationId]
        );

        if (!inventory) {
          throw new AppError(`Batch #${batchId} uchun ushbu lokatsiyada inventar topilmadi.`, 404);
        }

        assertEnoughStock(inventory, quantity);

        const totalPrice = quantity * unitPrice;
        totalQuantity += quantity;
        totalAmount += totalPrice;

        const existingBatchId = await resolveExistingId(conn, "seedling_batches", batchId);
        const existingInventoryId = await resolveExistingId(conn, "seedling_inventory", inventory.id);
        const seedlingTypeId =
          (await resolveOrderSeedlingTypeId(
            conn,
            inventory.seedling_type_id || null,
            inventory.variety_id || null
          )) || unknownCatalog.seedlingTypeId;
        const orderVarietyId = await resolveOrderVarietyId(
          conn,
          seedlingTypeId,
          inventory.variety_id || null
        );

        if (!existingBatchId) {
          throw new AppError(`Tanlangan partiya (#${batchId}) bazada topilmadi.`, 400);
        }

        if (!existingInventoryId) {
          throw new AppError(`Tanlangan partiya inventari (#${inventory.id}) topilmadi.`, 400);
        }

        parsedItems.push({
          batchId: existingBatchId,
          inventoryId: existingInventoryId,
          seedlingTypeId,
          varietyId: orderVarietyId,
          quantity,
          unitPrice,
          totalPrice
        });
      }

      const orderNumber = req.body.orderNumber || generateCode("ORD");
      const location = await fetchOne(
        conn,
        "SELECT id, name FROM locations WHERE id = ? LIMIT 1",
        [locationId]
      );
      const [orderResult] = await conn.query(
        `INSERT INTO orders
          (order_number, client_name, customer_name, customer_phone, location_id, status, order_date, note, notes,
           total_amount, total_quantity, quantity, fulfilled_quantity, shortage_quantity, batch_id,
           seedling_type_id, variety_id, created_by)
         VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
        [
          orderNumber,
          req.body.customerName,
          req.body.customerName,
          req.body.customerPhone || null,
          locationId,
          orderDate,
          req.body.notes || null,
          req.body.notes || null,
          totalAmount,
          totalQuantity,
          totalQuantity,
          parsedItems[0]?.batchId || null,
          parsedItems[0]?.seedlingTypeId || null,
          parsedItems[0]?.varietyId || null,
          req.user.id
        ]
      );

      for (const item of parsedItems) {
        await conn.query(
          `INSERT INTO order_items
            (order_id, batch_id, inventory_id, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [orderResult.insertId, item.batchId, item.inventoryId, item.quantity, item.unitPrice, item.totalPrice]
        );
      }

      await logActivity(conn, {
        actorUserId: req.user.id,
        action: "order_created",
        entityType: "order",
        entityId: orderResult.insertId,
        description: `${orderNumber} buyurtmasi yaratildi`,
        metadata: { locationId, totalQuantity, totalAmount, orderDate: orderDate.toISOString() }
      });

      const notificationRecipientIds = await getOrderNotificationRecipientIds(conn, locationId);
      await createNotifications(conn, notificationRecipientIds, {
        type: "order_created",
        title: "Yangi buyurtma yaratildi",
        message: `${orderNumber} buyurtmasi ${location?.name || "lokatsiya"} uchun yaratildi`,
        entityType: "order",
        entityId: orderResult.insertId,
        locationId,
        createdBy: req.user.id,
      });

      return {
        id: orderResult.insertId,
        orderNumber,
        status: "new",
        locationId,
        totalQuantity,
        totalAmount,
        createdAt: orderDate.toISOString()
      };
    });

    return sendCreated(res, result, "Order yaratildi.");
  })
);

router.post(
  "/:id/sell",
  authorize("admin", "agranom"),
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (conn) => {
      const orderId = toPositiveInt(req.params.id, "orderId");
      const order = await fetchOne(
        conn,
        "SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE",
        [orderId]
      );

      if (!order) {
        throw new AppError("Order topilmadi.", 404);
      }

      if (!["new", "partial", "shortage"].includes(order.status)) {
        throw new AppError("Faqat yangi yoki faol order sotilishi mumkin.", 400);
      }

      if (req.user.role === "agranom" && req.user.locationId !== order.location_id) {
        throw new AppError("Siz faqat o'zingizga biriktirilgan lokatsiya buyurtmasini sotishingiz mumkin.", 403);
      }

      const [items] = await conn.query(
        `SELECT oi.*, si.location_id, b.batch_code
         FROM order_items oi
         JOIN seedling_inventory si ON si.id = oi.inventory_id
         JOIN seedling_batches b ON b.id = oi.batch_id
         WHERE oi.order_id = ?
         ORDER BY oi.id ASC`,
        [orderId]
      );

      if (items.length === 0) {
        throw new AppError("Order itemlari topilmadi.", 400);
      }

      for (const item of items) {
        const inventory = await getInventoryById(conn, item.inventory_id, true);
        assertEnoughStock(inventory, item.quantity);

        await conn.query(
          `UPDATE seedling_inventory
           SET quantity_available = quantity_available - ?, last_activity_at = NOW()
           WHERE id = ?`,
          [item.quantity, inventory.id]
        );

        await conn.query(
          `INSERT INTO seedling_history
            (batch_id, inventory_id, action_type, from_location_id, previous_stage, next_stage,
             quantity, approval_status, requires_approval, reference_type, reference_id, notes, created_by)
           VALUES (?, ?, 'order_sale', ?, ?, ?, ?, 'approved', 0, 'order', ?, ?, ?)`,
          [
            item.batch_id,
            inventory.id,
            item.location_id,
            inventory.current_stage,
            inventory.current_stage,
            item.quantity,
            orderId,
            req.body.notes || `Order ${order.order_number} sotildi`,
            req.user.id
          ]
        );
      }

      await conn.query(
        `UPDATE orders
         SET status = 'completed', sold_by = ?, sold_at = NOW(), updated_at = NOW(),
             fulfilled_quantity = total_quantity, shortage_quantity = 0
         WHERE id = ?`,
        [req.user.id, orderId]
      );

      await logActivity(conn, {
        actorUserId: req.user.id,
        action: "order_sold",
        entityType: "order",
        entityId: orderId,
        description: `${order.order_number} order sotildi`,
        metadata: { totalQuantity: order.total_quantity, totalAmount: order.total_amount }
      });

      const notificationRecipientIds = await getNotificationRecipientIds(conn, {
        roles: ["admin", "bosh_agranom", "bugalter"],
        locationIds: [order.location_id],
        includeAgranomsForLocations: true,
        excludeUserIds: [req.user.id],
      });
      await createNotifications(conn, notificationRecipientIds, {
        type: "order_sold",
        title: "Buyurtma sotildi",
        message: `${order.order_number} buyurtmasi sotildi`,
        entityType: "order",
        entityId: orderId,
        locationId: order.location_id,
        createdBy: req.user.id,
      });

      return {
        id: orderId,
        orderNumber: order.order_number,
        status: "completed",
        soldBy: req.user.id,
        soldAt: new Date().toISOString()
      };
    });

    return sendOk(res, result, "Order sotildi.");
  })
);

export default router;
