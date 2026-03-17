import mysql from "mysql2/promise";
import env from "./src/config/env.js";

const connection = await mysql.createConnection({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
});

try {
  for (const tableName of ["seedling_batches", "seedling_inventory", "seedling_history"]) {
    const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
    console.log(`\n[${tableName}]`);
    for (const row of rows) {
      console.log(`${row.Field} | ${row.Type} | null=${row.Null} | default=${row.Default}`);
    }
  }
} finally {
  await connection.end();
}
