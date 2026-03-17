import mysql from "mysql2/promise";
import env from "../config/env.js";
import { ensureDatabaseReady } from "../db/bootstrap.js";

const defaultLocations = [
  {
    name: "Teplitsa 1",
    code: "TP-1",
    type: "greenhouse",
    capacity: 6000,
    description: "Asosiy ko'paytirish hududi.",
  },
  {
    name: "Teplitsa 2",
    code: "TP-2",
    type: "greenhouse",
    capacity: 5500,
    description: "Payvandlashdan keyingi kuzatuv bloki.",
  },
  {
    name: "Teplitsa 3",
    code: "TP-3",
    type: "greenhouse",
    capacity: 5000,
    description: "Ko'chatni kuchaytirish hududi.",
  },
  {
    name: "Teplitsa 4",
    code: "TP-4",
    type: "greenhouse",
    capacity: 5000,
    description: "Buyurtmaga tayyorlash uchun issiqxona maydoni.",
  },
  {
    name: "Teplitsa 5",
    code: "TP-5",
    type: "greenhouse",
    capacity: 4500,
    description: "Zaxira issiqxona maydoni.",
  },
  {
    name: "Ochiq dala 1",
    code: "OD-1",
    type: "open_field",
    capacity: 10000,
    description: "Ko'chirib ekish uchun ochiq dala hududi.",
  },
  {
    name: "Ochiq dala 2",
    code: "OD-2",
    type: "open_field",
    capacity: 9500,
    description: "Mavsumiy parvarish va chiniqtirish hududi.",
  },
  {
    name: "Ochiq dala 3",
    code: "OD-3",
    type: "open_field",
    capacity: 9000,
    description: "Tajriba va kuzatuv maydoni.",
  },
  {
    name: "Ochiq dala 4",
    code: "OD-4",
    type: "open_field",
    capacity: 8500,
    description: "Tayyor ko'chatni chiqarishdan oldingi maydon.",
  },
  {
    name: "Laboratoriya",
    code: "LAB-1",
    type: "laboratory",
    capacity: 3000,
    description: "Urug' va ko'paytirish laboratoriyasi.",
  },
];

async function seedLocations() {
  await ensureDatabaseReady();

  const connection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName,
  });

  try {
    await connection.beginTransaction();

    let created = 0;
    let updated = 0;

    for (const item of defaultLocations) {
      const [rows] = await connection.query(
        `SELECT id
         FROM locations
         WHERE code = ? OR name = ?
         LIMIT 1`,
        [item.code, item.name]
      );

      if (rows[0]) {
        await connection.query(
          `UPDATE locations
           SET name = ?, code = ?, type = ?, capacity = ?, description = ?, status = 'active'
           WHERE id = ?`,
          [item.name, item.code, item.type, item.capacity, item.description, rows[0].id]
        );
        updated += 1;
      } else {
        await connection.query(
          `INSERT INTO locations (name, code, type, capacity, description, status)
           VALUES (?, ?, ?, ?, ?, 'active')`,
          [item.name, item.code, item.type, item.capacity, item.description]
        );
        created += 1;
      }
    }

    await connection.query(
      `DELETE FROM locations
       WHERE code = 'HQ'
         AND name = ?
         AND NOT EXISTS (SELECT 1 FROM users WHERE location_id = locations.id)
         AND NOT EXISTS (SELECT 1 FROM seedling_inventory WHERE location_id = locations.id)
         AND NOT EXISTS (SELECT 1 FROM seedling_batches WHERE source_location_id = locations.id)`,
      [env.defaultLocationName]
    );

    await connection.commit();
    console.log("Standart obyektlar tayyor bo'ldi.");
    console.log({ created, updated, total: defaultLocations.length });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

seedLocations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Lokatsiya seed xatoligi:", error);
    process.exit(1);
  });
