import { Router } from "express";
import { getPool } from "../config/database.js";
import asyncHandler from "../utils/async-handler.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { sendOk } from "../utils/http.js";

const router = Router();

router.use(authenticate);
router.use(authorize("admin", "bosh_agranom", "bugalter", "manager"));

function buildDateRange(column, query) {
  const conditions = [];
  const params = [];

  if (query.dateFrom) {
    conditions.push(`${column} >= ?`);
    params.push(`${query.dateFrom} 00:00:00`);
  }

  if (query.dateTo) {
    conditions.push(`${column} <= ?`);
    params.push(`${query.dateTo} 23:59:59`);
  }

  return { conditions, params };
}

function buildInventoryFilters(query, inventoryAlias = "si", locationAlias = "l") {
  const conditions = [];
  const params = [];

  if (query.locationId) {
    conditions.push(`${inventoryAlias}.location_id = ?`);
    params.push(query.locationId);
  }

  if (query.type) {
    conditions.push(`${locationAlias}.type = ?`);
    params.push(query.type);
  }

  if (query.stage) {
    conditions.push(`${inventoryAlias}.current_stage = ?`);
    params.push(query.stage);
  }

  if (query.readyOnly === "true") {
    conditions.push(`${inventoryAlias}.current_stage = 'ready'`);
  }

  if (query.defectOnly === "true") {
    conditions.push(`${inventoryAlias}.defect_quantity > 0`);
  }

  if (query.dateFrom) {
    conditions.push(`${inventoryAlias}.last_activity_at >= ?`);
    params.push(`${query.dateFrom} 00:00:00`);
  }

  if (query.dateTo) {
    conditions.push(`${inventoryAlias}.last_activity_at <= ?`);
    params.push(`${query.dateTo} 23:59:59`);
  }

  return { conditions, params };
}

function buildTransferFilters(query, transferAlias = "t") {
  const conditions = [];
  const params = [];

  if (query.locationId) {
    conditions.push(`(${transferAlias}.from_location_id = ? OR ${transferAlias}.to_location_id = ?)`);
    params.push(query.locationId, query.locationId);
  }

  if (query.dateFrom) {
    conditions.push(`${transferAlias}.transfer_date >= ?`);
    params.push(`${query.dateFrom} 00:00:00`);
  }

  if (query.dateTo) {
    conditions.push(`${transferAlias}.transfer_date <= ?`);
    params.push(`${query.dateTo} 23:59:59`);
  }

  return { conditions, params };
}

function buildHistoryFilters(query, historyAlias = "h", fromLocationAlias = "fl", toLocationAlias = "tl") {
  const conditions = [`${historyAlias}.approval_status = 'approved'`];
  const params = [];

  if (query.locationId) {
    conditions.push(`(${historyAlias}.from_location_id = ? OR ${historyAlias}.to_location_id = ?)`);
    params.push(query.locationId, query.locationId);
  }

  if (query.type) {
    conditions.push(`(${fromLocationAlias}.type = ? OR ${toLocationAlias}.type = ?)`);
    params.push(query.type, query.type);
  }

  if (query.stage) {
    conditions.push(
      `(${historyAlias}.previous_stage = ? OR ${historyAlias}.next_stage = ? OR COALESCE(${historyAlias}.next_stage, ${historyAlias}.previous_stage) = ?)`
    );
    params.push(query.stage, query.stage, query.stage);
  }

  if (query.readyOnly === "true") {
    conditions.push(`(${historyAlias}.previous_stage = 'ready' OR ${historyAlias}.next_stage = 'ready')`);
  }

  if (query.defectOnly === "true") {
    conditions.push(`${historyAlias}.defect_quantity > 0`);
  }

  if (query.realizedOnly === "true") {
    conditions.push(`${historyAlias}.action_type = 'order_sale'`);
  }

  if (query.includeAllDates !== "true") {
    if (query.dateFrom) {
      conditions.push(`COALESCE(${historyAlias}.stage_date, ${historyAlias}.created_at) >= ?`);
      params.push(`${query.dateFrom} 00:00:00`);
    }

    if (query.dateTo) {
      conditions.push(`COALESCE(${historyAlias}.stage_date, ${historyAlias}.created_at) <= ?`);
      params.push(`${query.dateTo} 23:59:59`);
    }
  }

  return { conditions, params };
}

router.get(
  "/general",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const inventoryFilters = buildInventoryFilters(req.query, "si", "l");
    const transferFilters = buildTransferFilters(req.query, "t");

    const inventoryWhere = inventoryFilters.conditions.length
      ? `WHERE ${inventoryFilters.conditions.join(" AND ")}`
      : "";
    const transferWhere = transferFilters.conditions.length
      ? `WHERE ${transferFilters.conditions.join(" AND ")}`
      : "";

    const locationConditions = [];
    const locationParams = [];

    if (req.query.locationId) {
      locationConditions.push("id = ?");
      locationParams.push(req.query.locationId);
    }

    if (req.query.type) {
      locationConditions.push("type = ?");
      locationParams.push(req.query.type);
    }

    const locationWhere = locationConditions.length
      ? `WHERE ${locationConditions.join(" AND ")}`
      : "";

    const orderConditions = ["1 = 1"];
    const orderParams = [];

    if (req.query.locationId) {
      orderConditions.push("o.location_id = ?");
      orderParams.push(req.query.locationId);
    }

    if (req.query.realizedOnly === "true") {
      orderConditions.push("o.status = 'completed'");
    }

    if (req.query.dateFrom) {
      orderConditions.push("COALESCE(o.sold_at, o.order_date, o.created_at) >= ?");
      orderParams.push(`${req.query.dateFrom} 00:00:00`);
    }

    if (req.query.dateTo) {
      orderConditions.push("COALESCE(o.sold_at, o.order_date, o.created_at) <= ?");
      orderParams.push(`${req.query.dateTo} 23:59:59`);
    }

    const [counts] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users_count,
         (SELECT COUNT(*) FROM locations ${locationWhere}) AS locations_count,
         (SELECT COUNT(DISTINCT si.batch_id)
          FROM seedling_inventory si
          JOIN locations l ON l.id = si.location_id
          ${inventoryWhere}) AS batches_count,
         (SELECT COUNT(*)
          FROM orders o
          WHERE ${orderConditions.join(" AND ")}) AS orders_count,
         (SELECT COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_quantity ELSE 0 END), 0)
          FROM orders o
          WHERE ${orderConditions.join(" AND ")}) AS sold_quantity,
         (SELECT COUNT(*) FROM tasks) AS tasks_count,
         (SELECT COUNT(*) FROM transfers t ${transferWhere}) AS transfers_count`,
      [...locationParams, ...inventoryFilters.params, ...orderParams, ...orderParams, ...transferFilters.params]
    );

    const [inventoryByStage] = await pool.query(
      `SELECT si.current_stage, SUM(si.quantity_available) AS total_quantity, SUM(si.defect_quantity) AS total_defects
       FROM seedling_inventory si
       JOIN locations l ON l.id = si.location_id
       ${inventoryWhere}
       GROUP BY si.current_stage
       ORDER BY total_quantity DESC`,
      inventoryFilters.params
    );

    const [pendingActions] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM seedling_history WHERE approval_status = 'pending') AS pending_approvals,
         (SELECT COUNT(*) FROM transfers WHERE status <> 'completed') AS pending_transfers,
         (SELECT COUNT(*) FROM orders WHERE status IN ('new', 'partial', 'shortage')) AS draft_orders,
         (SELECT COUNT(*) FROM tasks WHERE status IN ('open', 'in_progress')) AS open_tasks`
    );

    return sendOk(res, {
      summary: counts[0],
      inventoryByStage,
      pendingActions: pendingActions[0],
    });
  })
);

router.get(
  "/locations",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const inventoryFilters = buildInventoryFilters(req.query, "si", "loc");
    const inventoryWhere = inventoryFilters.conditions.length
      ? `WHERE ${inventoryFilters.conditions.join(" AND ")}`
      : "";

    const conditions = ["1 = 1"];
    const params = [...inventoryFilters.params];

    if (req.query.locationId) {
      conditions.push("l.id = ?");
      params.push(req.query.locationId);
    }

    if (req.query.type) {
      conditions.push("l.type = ?");
      params.push(req.query.type);
    }

    if (req.query.realizedOnly === "true") {
      conditions.push("COALESCE(ord.sold_orders, 0) > 0");
    }

    if (req.query.defectOnly === "true") {
      conditions.push("COALESCE(inv.total_defects, 0) > 0");
    }

    if (req.query.readyOnly === "true") {
      conditions.push("COALESCE(inv.total_stock, 0) > 0");
    }

    const [rows] = await pool.query(
      `SELECT l.id, l.name, l.code, l.type, l.region, l.status,
              COALESCE(inv.total_stock, 0) AS total_stock,
              COALESCE(inv.total_defects, 0) AS total_defects,
              COALESCE(inv.active_batches, 0) AS active_batches,
              COALESCE(ts.open_tasks, 0) AS open_tasks,
              COALESCE(ord.sold_orders, 0) AS sold_orders,
              COALESCE(ord.sold_quantity, 0) AS sold_quantity,
              COALESCE(ord.total_amount, 0) AS total_sales
       FROM locations l
       LEFT JOIN (
         SELECT si.location_id,
                SUM(si.quantity_available) AS total_stock,
                SUM(si.defect_quantity) AS total_defects,
                COUNT(DISTINCT si.batch_id) AS active_batches
         FROM seedling_inventory si
         JOIN locations loc ON loc.id = si.location_id
         ${inventoryWhere}
         GROUP BY si.location_id
       ) inv ON inv.location_id = l.id
       LEFT JOIN (
         SELECT location_id, COUNT(*) AS open_tasks
         FROM tasks
         WHERE status IN ('open', 'in_progress')
         GROUP BY location_id
       ) ts ON ts.location_id = l.id
       LEFT JOIN (
         SELECT location_id,
                COUNT(*) AS sold_orders,
                SUM(total_quantity) AS sold_quantity,
                SUM(total_amount) AS total_amount
         FROM orders
         WHERE status = 'completed'
         GROUP BY location_id
       ) ord ON ord.location_id = l.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY total_stock DESC, l.id DESC`,
      params
    );

    return sendOk(res, rows);
  })
);

router.get(
  "/movements",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const historyFilters = buildHistoryFilters(req.query, "h", "fl", "tl");

    const [rows] = await pool.query(
      `SELECT h.id,
              h.action_type,
              h.reference_type,
              h.reference_id,
              h.quantity,
              h.defect_quantity,
              h.previous_stage,
              h.next_stage,
              COALESCE(h.stage_date, h.created_at) AS movement_date,
              h.created_at,
              b.id AS batch_id,
              b.batch_code,
              st.name AS seedling_type_name,
              v.name AS variety_name,
              fl.id AS from_location_id,
              fl.name AS from_location_name,
              fl.type AS from_location_type,
              tl.id AS to_location_id,
              tl.name AS to_location_name,
              tl.type AS to_location_type
       FROM seedling_history h
       JOIN seedling_batches b ON b.id = h.batch_id
       LEFT JOIN seedling_types st ON st.id = b.seedling_type_id
       LEFT JOIN varieties v ON v.id = b.variety_id
       LEFT JOIN locations fl ON fl.id = h.from_location_id
       LEFT JOIN locations tl ON tl.id = h.to_location_id
       WHERE ${historyFilters.conditions.join(" AND ")}
       ORDER BY movement_date DESC, h.id DESC`,
      historyFilters.params
    );

    return sendOk(res, rows);
  })
);

router.get(
  "/defects",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const inventoryFilters = buildInventoryFilters(req.query, "si", "l");
    inventoryFilters.conditions.push("si.defect_quantity > 0");
    const inventoryWhere = `WHERE ${inventoryFilters.conditions.join(" AND ")}`;

    const [rows] = await pool.query(
      `SELECT si.id AS inventory_id, si.defect_quantity, si.quantity_available,
              ROUND((si.defect_quantity / NULLIF(si.quantity_available + si.defect_quantity, 0)) * 100, 2) AS defect_rate,
              b.id AS batch_id, b.batch_code,
              st.name AS seedling_type_name,
              v.name AS variety_name,
              l.name AS location_name
       FROM seedling_inventory si
       JOIN seedling_batches b ON b.id = si.batch_id
       JOIN seedling_types st ON st.id = b.seedling_type_id
       JOIN varieties v ON v.id = b.variety_id
       JOIN locations l ON l.id = si.location_id
       ${inventoryWhere}
       ORDER BY si.defect_quantity DESC, defect_rate DESC`,
      inventoryFilters.params
    );

    const [summary] = await pool.query(
      `SELECT
         SUM(si.defect_quantity) AS total_defects,
         SUM(si.quantity_available) AS total_healthy,
         ROUND((SUM(si.defect_quantity) / NULLIF(SUM(si.quantity_available) + SUM(si.defect_quantity), 0)) * 100, 2) AS overall_defect_rate
       FROM seedling_inventory si
       JOIN locations l ON l.id = si.location_id
       ${inventoryWhere}`,
      inventoryFilters.params
    );

    return sendOk(res, {
      summary: summary[0],
      items: rows,
    });
  })
);

router.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const { conditions, params } = buildDateRange("COALESCE(o.sold_at, o.order_date, o.created_at)", req.query);

    if (req.query.locationId) {
      conditions.push("o.location_id = ?");
      params.push(req.query.locationId);
    }

    if (req.query.realizedOnly === "true") {
      conditions.push("o.status = 'completed'");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [summary] = await pool.query(
      `SELECT
         COUNT(*) AS total_orders,
         SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) AS sold_orders,
         SUM(CASE WHEN o.status IN ('new', 'partial', 'shortage') THEN 1 ELSE 0 END) AS draft_orders,
         SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END) AS sold_amount,
         SUM(CASE WHEN o.status = 'completed' THEN o.total_quantity ELSE 0 END) AS sold_quantity
       FROM orders o
       ${whereClause}`,
      params
    );

    const [daily] = await pool.query(
      `SELECT DATE(COALESCE(o.sold_at, o.order_date, o.created_at)) AS report_date,
              COUNT(*) AS total_orders,
              SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END) AS sold_amount,
              SUM(CASE WHEN o.status = 'completed' THEN o.total_quantity ELSE 0 END) AS sold_quantity
       FROM orders o
       ${whereClause}
       GROUP BY DATE(COALESCE(o.sold_at, o.order_date, o.created_at))
       ORDER BY report_date DESC`,
      params
    );

    const [byLocation] = await pool.query(
      `SELECT l.id AS location_id, l.name AS location_name,
              COUNT(o.id) AS total_orders,
              SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END) AS sold_amount
       FROM orders o
       JOIN locations l ON l.id = o.location_id
       ${whereClause}
       GROUP BY l.id
       ORDER BY sold_amount DESC`,
      params
    );

    return sendOk(res, {
      summary: summary[0],
      daily,
      byLocation,
    });
  })
);

router.get(
  "/tasks",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const { conditions, params } = buildDateRange("t.created_at", req.query);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [summaryByStatus] = await pool.query(
      `SELECT t.status, COUNT(*) AS total
       FROM tasks t
       ${whereClause}
       GROUP BY t.status
       ORDER BY total DESC`,
      params
    );

    const [summaryByPriority] = await pool.query(
      `SELECT t.priority, COUNT(*) AS total
       FROM tasks t
       ${whereClause}
       GROUP BY t.priority
       ORDER BY total DESC`,
      params
    );

    const [byAssignee] = await pool.query(
      `SELECT COALESCE(u.id, 0) AS assignee_id, COALESCE(u.full_name, 'Unassigned') AS assignee_name,
              COUNT(t.id) AS total_tasks
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       ${whereClause}
       GROUP BY u.id, u.full_name
       ORDER BY total_tasks DESC`,
      params
    );

    const [overdue] = await pool.query(
      `SELECT t.*, u.full_name AS assigned_to_name, l.name AS location_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN locations l ON l.id = t.location_id
       WHERE t.due_date IS NOT NULL AND t.due_date < NOW() AND t.status <> 'done'
       ORDER BY t.due_date ASC`
    );

    return sendOk(res, {
      summaryByStatus,
      summaryByPriority,
      byAssignee,
      overdue,
    });
  })
);

export default router;
