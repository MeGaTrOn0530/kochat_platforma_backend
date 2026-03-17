export async function fetchOne(executor, sql, params = []) {
  const [rows] = await executor.query(sql, params);
  return rows[0] || null;
}

export function buildUpdateColumns(columnMap) {
  const entries = Object.entries(columnMap).filter(([, value]) => value !== undefined);

  return {
    hasValues: entries.length > 0,
    sql: entries.map(([column]) => `${column} = ?`).join(", "),
    values: entries.map(([, value]) => value)
  };
}
