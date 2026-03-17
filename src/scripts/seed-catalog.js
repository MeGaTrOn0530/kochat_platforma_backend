import mysql from "mysql2/promise";
import env from "../config/env.js";
import { ensureDatabaseReady } from "../db/bootstrap.js";
import { seedDefaultCatalog } from "../db/catalog-seed.js";
import { ensureUnknownCatalog } from "../utils/inventory.js";

async function seedCatalog() {
  await ensureDatabaseReady();

  const connection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    database: env.dbName,
    multipleStatements: true,
  });

  try {
    await connection.beginTransaction();

    const unknownCatalog = await ensureUnknownCatalog(connection);
    const { rootstockStats, seedlingStats, varietyStats } = await seedDefaultCatalog(
      connection,
      unknownCatalog
    );

    await connection.commit();

    console.log("Katalog seed yakunlandi.");
    console.log("Payvandtag turlari:", rootstockStats);
    console.log("Ko'chat turlari:", seedlingStats);
    console.log("Ko'chat navlari:", varietyStats);
    console.log(
      `Navlar hozircha "${unknownCatalog.seedlingType.name}" turi ostiga yozildi.`
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

seedCatalog()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Katalog seed xatoligi:", error);
    process.exit(1);
  });
