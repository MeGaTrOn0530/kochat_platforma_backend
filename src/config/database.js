import mysql from "mysql2/promise";
import env from "./env.js";

let pool;

export function initPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.dbHost,
      port: env.dbPort,
      user: env.dbUser,
      password: env.dbPassword,
      database: env.dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      decimalNumbers: true
    });
  }

  return pool;
}

export function getPool() {
  if (!pool) {
    throw new Error("Database pool has not been initialized yet.");
  }

  return pool;
}

export async function query(sql, params = []) {
  const activePool = getPool();
  const [rows] = await activePool.query(sql, params);
  return rows;
}

export async function withTransaction(callback) {
  const activePool = getPool();
  const connection = await activePool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
