import AppError from "./app-error.js";
import { fetchOne } from "./db-helpers.js";

const UNKNOWN_TYPE_NAME = "Aniqlanmagan";
const UNKNOWN_TYPE_CODE = "UNKNOWN-TYPE";
const UNKNOWN_VARIETY_NAME = "Aniqlanmagan nav";
const UNKNOWN_VARIETY_CODE = "UNKNOWN-VARIETY";

export async function getInventoryByBatchAndLocation(executor, batchId, locationId, lock = false) {
  const sql = `SELECT *
               FROM seedling_inventory
               WHERE batch_id = ? AND location_id = ?
               LIMIT 1${lock ? " FOR UPDATE" : ""}`;
  return fetchOne(executor, sql, [batchId, locationId]);
}

export async function getInventoryById(executor, inventoryId, lock = false) {
  const sql = `SELECT *
               FROM seedling_inventory
               WHERE id = ?
               LIMIT 1${lock ? " FOR UPDATE" : ""}`;
  return fetchOne(executor, sql, [inventoryId]);
}

export async function ensureLocationExists(executor, locationId) {
  const location = await fetchOne(
    executor,
    "SELECT id, name, code, type, status FROM locations WHERE id = ? LIMIT 1",
    [locationId]
  );

  if (!location) {
    throw new AppError("Lokatsiya topilmadi.", 404);
  }

  return location;
}

export async function ensureSeedlingTypeExists(executor, seedlingTypeId) {
  const type = await fetchOne(
    executor,
    "SELECT id, name, code FROM seedling_types WHERE id = ? LIMIT 1",
    [seedlingTypeId]
  );

  if (!type) {
    throw new AppError("Seedling type topilmadi.", 404);
  }

  return type;
}

export async function ensureVarietyExists(executor, varietyId) {
  const variety = await fetchOne(
    executor,
    "SELECT id, seedling_type_id, name, code FROM varieties WHERE id = ? LIMIT 1",
    [varietyId]
  );

  if (!variety) {
    throw new AppError("Variety topilmadi.", 404);
  }

  return variety;
}

export async function ensureRootstockTypeExists(executor, rootstockTypeId) {
  const rootstock = await fetchOne(
    executor,
    "SELECT id, name, code FROM rootstock_types WHERE id = ? LIMIT 1",
    [rootstockTypeId]
  );

  if (!rootstock) {
    throw new AppError("Payvandtag turi topilmadi.", 404);
  }

  return rootstock;
}

export async function ensureUnknownCatalog(executor) {
  let seedlingType = await fetchOne(
    executor,
    `SELECT id, name, code
     FROM seedling_types
     WHERE code = ? OR name = ?
     LIMIT 1`,
    [UNKNOWN_TYPE_CODE, UNKNOWN_TYPE_NAME]
  );

  if (!seedlingType) {
    const [result] = await executor.query(
      `INSERT INTO seedling_types (name, code, description)
       VALUES (?, ?, ?)`,
      [UNKNOWN_TYPE_NAME, UNKNOWN_TYPE_CODE, "Birlamchi kirimda turi hali aniqlanmagan ko'chatlar uchun."]
    );

    seedlingType = {
      id: result.insertId,
      name: UNKNOWN_TYPE_NAME,
      code: UNKNOWN_TYPE_CODE
    };
  }

  let variety = await fetchOne(
    executor,
    `SELECT id, seedling_type_id, name, code
     FROM varieties
     WHERE seedling_type_id = ? AND (code = ? OR name = ?)
     LIMIT 1`,
    [seedlingType.id, UNKNOWN_VARIETY_CODE, UNKNOWN_VARIETY_NAME]
  );

  if (!variety) {
    const [result] = await executor.query(
      `INSERT INTO varieties (seedling_type_id, name, code, description)
       VALUES (?, ?, ?, ?)`,
      [
        seedlingType.id,
        UNKNOWN_VARIETY_NAME,
        UNKNOWN_VARIETY_CODE,
        "Birlamchi kirimda navi hali aniqlanmagan ko'chatlar uchun."
      ]
    );

    variety = {
      id: result.insertId,
      seedling_type_id: seedlingType.id,
      name: UNKNOWN_VARIETY_NAME,
      code: UNKNOWN_VARIETY_CODE
    };
  }

  return {
    seedlingTypeId: seedlingType.id,
    varietyId: variety.id,
    seedlingType,
    variety
  };
}

export async function ensureFallbackVarietyForType(executor, seedlingTypeId) {
  const firstVariety = await fetchOne(
    executor,
    `SELECT id, seedling_type_id, name, code
     FROM varieties
     WHERE seedling_type_id = ?
     ORDER BY CASE WHEN code = ? THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [seedlingTypeId, UNKNOWN_VARIETY_CODE]
  );

  if (firstVariety) {
    return firstVariety;
  }

  const [result] = await executor.query(
    `INSERT INTO varieties (seedling_type_id, name, code, description)
     VALUES (?, ?, ?, ?)`,
    [
      seedlingTypeId,
      UNKNOWN_VARIETY_NAME,
      `${UNKNOWN_VARIETY_CODE}-${seedlingTypeId}`,
      "Avtomatik yaratilgan fallback nav."
    ]
  );

  return {
    id: result.insertId,
    seedling_type_id: seedlingTypeId,
    name: UNKNOWN_VARIETY_NAME,
    code: `${UNKNOWN_VARIETY_CODE}-${seedlingTypeId}`
  };
}

export function assertEnoughStock(inventory, requestedQuantity) {
  if (!inventory || inventory.quantity_available < requestedQuantity) {
    throw new AppError("Mavjud ko'chat soni yetarli emas.", 400);
  }
}
