import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import env from "../config/env.js";
import { ensureUnknownCatalog } from "../utils/inventory.js";
import { seedDefaultCatalog } from "./catalog-seed.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function splitSqlStatements(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/;\s*[\r\n]+/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ?
     LIMIT 1`,
    [env.dbName, tableName]
  );

  return Boolean(rows[0]);
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?
     LIMIT 1`,
    [env.dbName, tableName, columnName]
  );

  return Boolean(rows[0]);
}

async function ensureColumn(connection, tableName, columnName, definition) {
  if (!(await tableExists(connection, tableName))) {
    return;
  }

  if (await columnExists(connection, tableName, columnName)) {
    return;
  }

  await connection.query(
    `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
  );
}

async function ensureLegacyCompatibility(connection) {
  const compatibilityColumns = {
    locations: {
      code: "VARCHAR(50) NULL",
      type: "VARCHAR(50) NOT NULL DEFAULT 'greenhouse'",
      capacity: "INT NOT NULL DEFAULT 0",
      description: "TEXT NULL",
      region: "VARCHAR(120) NULL",
      address: "VARCHAR(255) NULL",
      status: "VARCHAR(30) NOT NULL DEFAULT 'active'",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    users: {
      full_name: "VARCHAR(120) NULL",
      email: "VARCHAR(120) NULL",
      phone: "VARCHAR(40) NULL",
      password_hash: "VARCHAR(255) NULL",
      role: "VARCHAR(50) NOT NULL DEFAULT 'operator'",
      location_id: "INT NULL",
      avatar_path: "VARCHAR(255) NULL",
      status: "VARCHAR(30) NOT NULL DEFAULT 'active'",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    auth_sessions: {
      user_id: "INT NULL",
      jti: "CHAR(36) NULL",
      expires_at: "DATETIME NULL",
      logged_out_at: "DATETIME NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
    },
    seedling_types: {
      code: "VARCHAR(50) NULL",
      description: "TEXT NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    rootstock_types: {
      code: "VARCHAR(50) NULL",
      description: "TEXT NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    varieties: {
      seedling_type_id: "INT NULL",
      code: "VARCHAR(50) NULL",
      description: "TEXT NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    seedling_batches: {
      batch_number: "VARCHAR(80) NULL",
      batch_code: "VARCHAR(80) NULL",
      seedling_type_id: "INT NULL",
      variety_id: "INT NULL",
      rootstock_type_id: "INT NULL",
      source_location_id: "INT NULL",
      received_date: "DATE NULL",
      initial_quantity: "INT NOT NULL DEFAULT 0",
      notes: "TEXT NULL",
      created_by: "INT NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    seedling_inventory: {
      batch_id: "INT NULL",
      location_id: "INT NULL",
      current_stage: "VARCHAR(50) NOT NULL DEFAULT 'received'",
      quantity_available: "INT NOT NULL DEFAULT 0",
      defect_quantity: "INT NOT NULL DEFAULT 0",
      last_activity_at: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    seedling_history: {
      batch_id: "INT NULL",
      inventory_id: "INT NULL",
      action_type: "VARCHAR(50) NULL",
      from_location_id: "INT NULL",
      to_location_id: "INT NULL",
      previous_stage: "VARCHAR(50) NULL",
      next_stage: "VARCHAR(50) NULL",
      quantity: "INT NOT NULL DEFAULT 0",
      defect_quantity: "INT NOT NULL DEFAULT 0",
      image_paths: "LONGTEXT NULL",
      stage_date: "DATETIME NULL",
      approval_status: "VARCHAR(30) NOT NULL DEFAULT 'approved'",
      requires_approval: "TINYINT(1) NOT NULL DEFAULT 0",
      approved_by: "INT NULL",
      approved_at: "DATETIME NULL",
      approval_note: "VARCHAR(255) NULL",
      reference_type: "VARCHAR(50) NULL",
      reference_id: "INT NULL",
      notes: "TEXT NULL",
      created_by: "INT NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
    },
    transfers: {
      transfer_code: "VARCHAR(80) NULL",
      batch_id: "INT NULL",
      from_inventory_id: "INT NULL",
      from_location_id: "INT NULL",
      to_location_id: "INT NULL",
      quantity: "INT NOT NULL DEFAULT 0",
      transfer_type: "VARCHAR(30) NOT NULL DEFAULT 'movement'",
      transfer_date: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
      stage_on_transfer: "VARCHAR(50) NOT NULL DEFAULT 'received'",
      note: "TEXT NULL",
      notes: "TEXT NULL",
      status: "VARCHAR(30) NOT NULL DEFAULT 'pending_sender'",
      created_by: "INT NULL",
      sender_confirmed: "TINYINT(1) NOT NULL DEFAULT 0",
      sender_confirmed_by: "INT NULL",
      sender_confirmed_at: "DATETIME NULL",
      head_confirmed: "TINYINT(1) NOT NULL DEFAULT 0",
      head_confirmed_by: "INT NULL",
      head_confirmed_at: "DATETIME NULL",
      receiver_confirmed: "TINYINT(1) NOT NULL DEFAULT 0",
      receiver_confirmed_by: "INT NULL",
      receiver_confirmed_at: "DATETIME NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    orders: {
      order_number: "VARCHAR(80) NULL",
      client_name: "VARCHAR(120) NULL",
      customer_name: "VARCHAR(120) NULL",
      customer_phone: "VARCHAR(40) NULL",
      location_id: "INT NULL",
      status: "VARCHAR(30) NOT NULL DEFAULT 'new'",
      order_date: "DATETIME NULL",
      note: "TEXT NULL",
      notes: "TEXT NULL",
      total_amount: "DECIMAL(14,2) NOT NULL DEFAULT 0",
      total_quantity: "INT NOT NULL DEFAULT 0",
      quantity: "INT NOT NULL DEFAULT 0",
      fulfilled_quantity: "INT NOT NULL DEFAULT 0",
      shortage_quantity: "INT NOT NULL DEFAULT 0",
      batch_id: "INT NULL",
      seedling_type_id: "INT NULL",
      variety_id: "INT NULL",
      created_by: "INT NULL",
      sold_by: "INT NULL",
      sold_at: "DATETIME NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    order_items: {
      order_id: "INT NULL",
      batch_id: "INT NULL",
      inventory_id: "INT NULL",
      quantity: "INT NOT NULL DEFAULT 0",
      unit_price: "DECIMAL(14,2) NOT NULL DEFAULT 0",
      total_price: "DECIMAL(14,2) NOT NULL DEFAULT 0",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
    },
    tasks: {
      title: "VARCHAR(160) NULL",
      description: "TEXT NULL",
      location_id: "INT NULL",
      assigned_to: "INT NULL",
      created_by: "INT NULL",
      status: "VARCHAR(30) NOT NULL DEFAULT 'open'",
      priority: "VARCHAR(30) NOT NULL DEFAULT 'medium'",
      due_date: "DATETIME NULL",
      completed_at: "DATETIME NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    customer_products: {
      name: "VARCHAR(160) NULL",
      description: "TEXT NULL",
      price: "DECIMAL(14,2) NOT NULL DEFAULT 0",
      image_path: "VARCHAR(255) NULL",
      contact_phone: "VARCHAR(40) NULL",
      contact_phone_secondary: "VARCHAR(40) NULL",
      contact_note: "VARCHAR(255) NULL",
      is_active: "TINYINT(1) NOT NULL DEFAULT 1",
      display_order: "INT NOT NULL DEFAULT 0",
      created_by: "INT NULL",
      updated_by: "INT NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    },
    notifications: {
      recipient_user_id: "INT NULL",
      type: "VARCHAR(50) NOT NULL DEFAULT 'info'",
      title: "VARCHAR(160) NULL",
      message: "VARCHAR(255) NULL",
      entity_type: "VARCHAR(80) NULL",
      entity_id: "INT NULL",
      location_id: "INT NULL",
      is_read: "TINYINT(1) NOT NULL DEFAULT 0",
      read_at: "DATETIME NULL",
      created_by: "INT NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
    },
    activity_logs: {
      actor_user_id: "INT NULL",
      action: "VARCHAR(80) NOT NULL DEFAULT 'system_event'",
      entity_type: "VARCHAR(80) NOT NULL DEFAULT 'system'",
      entity_id: "VARCHAR(80) NOT NULL DEFAULT '0'",
      description: "VARCHAR(255) NOT NULL DEFAULT 'system event'",
      metadata: "JSON NULL",
      created_at: "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP"
    }
  };

  for (const [tableName, columns] of Object.entries(compatibilityColumns)) {
    for (const [columnName, definition] of Object.entries(columns)) {
      await ensureColumn(connection, tableName, columnName, definition);
    }
  }

  // Populate legacy rows with stable fallback codes so frontend/API responses stay usable.
  if (await tableExists(connection, "locations")) {
    await connection.query(
      `UPDATE locations
       SET code = COALESCE(NULLIF(code, ''), CONCAT('LOC-', id))
       WHERE code IS NULL OR code = ''`
    );
  }

  if (await tableExists(connection, "seedling_types")) {
    await connection.query(
      `UPDATE seedling_types
       SET code = COALESCE(NULLIF(code, ''), CONCAT('TYPE-', id))
       WHERE code IS NULL OR code = ''`
    );
  }

  if (await tableExists(connection, "varieties")) {
    await connection.query(
      `UPDATE varieties
       SET code = COALESCE(NULLIF(code, ''), CONCAT('VAR-', id))
       WHERE code IS NULL OR code = ''`
    );
  }

  if (await tableExists(connection, "seedling_batches")) {
    await connection.query(
      `UPDATE seedling_batches
       SET batch_code = COALESCE(NULLIF(batch_code, ''), CONCAT('BATCH-', LPAD(id, 5, '0')))
       WHERE batch_code IS NULL OR batch_code = ''`
    );

    if (await columnExists(connection, "seedling_batches", "batch_number")) {
      await connection.query(
        `UPDATE seedling_batches
         SET batch_number = COALESCE(NULLIF(batch_number, ''), batch_code)
         WHERE batch_number IS NULL OR batch_number = ''`
      );
    }
  }

  if (await tableExists(connection, "transfers")) {
    await connection.query(
      `UPDATE transfers
       SET transfer_code = COALESCE(NULLIF(transfer_code, ''), CONCAT('TRF-', LPAD(id, 5, '0'))),
           transfer_type = COALESCE(NULLIF(transfer_type, ''), 'movement'),
           transfer_date = COALESCE(transfer_date, created_at),
           note = COALESCE(note, notes),
           sender_confirmed = IF(
             COALESCE(sender_confirmed, 0) = 1 OR sender_confirmed_by IS NOT NULL OR sender_confirmed_at IS NOT NULL,
             1,
             0
           ),
           head_confirmed = IF(
             COALESCE(head_confirmed, 0) = 1 OR head_confirmed_by IS NOT NULL OR head_confirmed_at IS NOT NULL,
             1,
             0
           ),
           receiver_confirmed = IF(
             COALESCE(receiver_confirmed, 0) = 1 OR receiver_confirmed_by IS NOT NULL OR receiver_confirmed_at IS NOT NULL,
             1,
             0
           ),
           status = CASE
             WHEN receiver_confirmed_by IS NOT NULL OR receiver_confirmed_at IS NOT NULL OR COALESCE(receiver_confirmed, 0) = 1
               THEN 'completed'
             WHEN head_confirmed_by IS NOT NULL OR head_confirmed_at IS NOT NULL OR COALESCE(head_confirmed, 0) = 1
               THEN 'pending_receiver'
             WHEN sender_confirmed_by IS NOT NULL OR sender_confirmed_at IS NOT NULL OR COALESCE(sender_confirmed, 0) = 1
               THEN 'pending_head'
             ELSE 'pending_sender'
           END
       WHERE transfer_code IS NULL
          OR transfer_code = ''
          OR transfer_type IS NULL
          OR transfer_type = ''
          OR transfer_date IS NULL
          OR note IS NULL
          OR sender_confirmed IS NULL
          OR head_confirmed IS NULL
          OR receiver_confirmed IS NULL
          OR status IS NULL
          OR status IN ('pending', 'in_progress', 'awaiting_receiver')`
    );
  }

  if (await tableExists(connection, "orders")) {
    await connection.query(
      `UPDATE orders
       SET order_number = COALESCE(NULLIF(order_number, ''), CONCAT('ORD-', LPAD(id, 5, '0'))),
           client_name = COALESCE(NULLIF(client_name, ''), customer_name),
           status = IF(status = 'draft', 'new', status),
           order_date = COALESCE(order_date, created_at),
           note = COALESCE(note, notes),
           quantity = IF(COALESCE(quantity, 0) > 0, quantity, total_quantity),
           fulfilled_quantity = IF(
             COALESCE(fulfilled_quantity, 0) > 0 OR status <> 'completed',
             COALESCE(fulfilled_quantity, 0),
             total_quantity
           ),
           shortage_quantity = GREATEST(
             total_quantity - IF(
               COALESCE(fulfilled_quantity, 0) > 0 OR status <> 'completed',
               COALESCE(fulfilled_quantity, 0),
               total_quantity
             ),
             0
           )
       WHERE order_number IS NULL
          OR order_number = ''
          OR client_name IS NULL
          OR client_name = ''
          OR order_date IS NULL
          OR note IS NULL
          OR quantity IS NULL
          OR quantity = 0
          OR fulfilled_quantity IS NULL
          OR shortage_quantity IS NULL`
    );

    if (await tableExists(connection, "order_items")) {
      await connection.query(
        `UPDATE orders o
         LEFT JOIN (
           SELECT oi.order_id, MIN(oi.batch_id) AS batch_id
           FROM order_items oi
           GROUP BY oi.order_id
         ) first_item ON first_item.order_id = o.id
         LEFT JOIN seedling_batches b ON b.id = first_item.batch_id
         SET o.batch_id = COALESCE(o.batch_id, first_item.batch_id),
             o.seedling_type_id = COALESCE(o.seedling_type_id, b.seedling_type_id),
             o.variety_id = COALESCE(o.variety_id, b.variety_id)
         WHERE (o.batch_id IS NULL OR o.seedling_type_id IS NULL OR o.variety_id IS NULL)
           AND first_item.batch_id IS NOT NULL`
      );
    }
  }
}

export async function ensureDatabaseReady() {
  const adminConnection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    multipleStatements: true
  });

  try {
    await adminConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await adminConnection.end();
  }

  const dbConnection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName,
    multipleStatements: true
  });

  try {
    const schemaPath = path.join(__dirname, "schema.sql");
    const rawSchema = await fs.readFile(schemaPath, "utf8");
    const statements = splitSqlStatements(rawSchema);

    for (const statement of statements) {
      await dbConnection.query(statement);
    }

    await ensureLegacyCompatibility(dbConnection);
    const unknownCatalog = await ensureUnknownCatalog(dbConnection);
    await seedDefaultCatalog(dbConnection, unknownCatalog);

    const [locationRows] = await dbConnection.query(
      "SELECT id FROM locations WHERE code = ? LIMIT 1",
      [env.defaultLocationCode]
    );

    let locationId = locationRows[0]?.id;

    if (!locationId) {
      const [locationResult] = await dbConnection.query(
        `INSERT INTO locations (name, code, status)
         VALUES (?, ?, 'active')`,
        [env.defaultLocationName, env.defaultLocationCode]
      );
      locationId = locationResult.insertId;
    }

    if (env.defaultAdminUsername && env.defaultAdminPassword) {
      const [userRows] = await dbConnection.query(
        "SELECT id FROM users WHERE username = ? LIMIT 1",
        [env.defaultAdminUsername]
      );

      if (!userRows[0]) {
        const passwordHash = await bcrypt.hash(env.defaultAdminPassword, 10);

        await dbConnection.query(
          `INSERT INTO users
            (full_name, username, password_hash, role, location_id, status)
           VALUES (?, ?, ?, 'admin', ?, 'active')`,
          [env.defaultAdminFullName, env.defaultAdminUsername, passwordHash, locationId]
        );
      } else {
        await dbConnection.query(
          `UPDATE users
           SET role = 'admin',
               location_id = COALESCE(location_id, ?),
               status = COALESCE(NULLIF(status, ''), 'active')
           WHERE username = ?`,
          [locationId, env.defaultAdminUsername]
        );
      }
    }
  } finally {
    await dbConnection.end();
  }
}
