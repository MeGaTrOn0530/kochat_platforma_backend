import mysql from "mysql2/promise";
import env from "../config/env.js";
import { ensureDatabaseReady } from "../db/bootstrap.js";

const defaultLocations = [
  ["Teplitsa 1", "TP-1", "greenhouse", 6000, "Asosiy ko'paytirish hududi."],
  ["Teplitsa 2", "TP-2", "greenhouse", 5500, "Payvandlashdan keyingi kuzatuv bloki."],
  ["Teplitsa 3", "TP-3", "greenhouse", 5000, "Ko'chatni kuchaytirish hududi."],
  ["Teplitsa 4", "TP-4", "greenhouse", 5000, "Buyurtmaga tayyorlash uchun issiqxona maydoni."],
  ["Teplitsa 5", "TP-5", "greenhouse", 4500, "Zaxira issiqxona maydoni."],
  ["Ochiq dala 1", "OD-1", "open_field", 10000, "Ko'chirib ekish uchun ochiq dala hududi."],
  ["Ochiq dala 2", "OD-2", "open_field", 9500, "Mavsumiy parvarish va chiniqtirish hududi."],
  ["Ochiq dala 3", "OD-3", "open_field", 9000, "Tajriba va kuzatuv maydoni."],
  ["Ochiq dala 4", "OD-4", "open_field", 8500, "Tayyor ko'chatni chiqarishdan oldingi maydon."],
  ["Laboratoriya", "LAB-1", "laboratory", 3000, "Urug' va ko'paytirish laboratoriyasi."],
];

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?
     LIMIT 1`,
    [tableName]
  );

  return Boolean(rows[0]);
}

async function resetDatabase() {
  await ensureDatabaseReady();

  const connection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName,
    multipleStatements: true,
  });

  const tablesToTruncate = [
    "activity_logs",
    "auth_sessions",
    "customer_products",
    "order_items",
    "orders",
    "transfers",
    "seedling_history",
    "seedling_inventory",
    "seedling_batches",
    "tasks",
    "varieties",
    "seedling_types",
    "rootstock_types",
    "users",
    "locations",
  ];

  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tableName of tablesToTruncate) {
      if (await tableExists(connection, tableName)) {
        await connection.query(`TRUNCATE TABLE \`${tableName}\``);
      }
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  } catch (error) {
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch {}
    throw error;
  } finally {
    await connection.end();
  }

  await ensureDatabaseReady();

  const seedConnection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName,
  });

  try {
    await seedConnection.query("UPDATE users SET location_id = NULL WHERE role = 'admin'");

    for (const [name, code, type, capacity, description] of defaultLocations) {
      await seedConnection.query(
        `INSERT INTO locations (name, code, type, capacity, description, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [name, code, type, capacity, description]
      );
    }

    await seedConnection.query(
      `DELETE FROM locations
       WHERE code = 'HQ'
         AND name = ?`,
      [env.defaultLocationName]
    );
  } finally {
    await seedConnection.end();
  }

  console.log("Baza tozalandi. Default admin, aniqlanmagan katalog va 10 ta standart obyekt qayta yaratildi.");
}

resetDatabase()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Baza reset xatoligi:", error);
    process.exit(1);
  });
