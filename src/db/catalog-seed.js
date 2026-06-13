const rootstockTypes = [
  "CAB-6P",
  "GARNEM",
  "GFF-677",
  "GISELLA-17",
  "GISELLA-6",
  "MAXIMA-14",
  "MIRARED",
  "MYROBLAN-29C",
  "OBLACHINESKAYA",
  "OHF",
  "VISEL",
];

const seedlingTypes = [
  "Achchiq gilos",
  "Bodom",
  "Gilos",
  "Nok",
  "Sliva",
  "Uzum",
  "O'rik",
  "Shaftoli",
];

const varieties = [
  "Avatar",
  "Avijor",
  "Agromir",
  "Batirmo",
  "Big ben",
  "Blek daymond",
  "Blek splendr",
  "Boving",
  "Bordo",
  "Britilayn",
  "Venus",
  "Viyalfas",
  "Zumba",
  "Lapins",
  "Litovka",
  "Lusiana",
  "Maykriste",
  "Mardiya",
  "Marsiana",
  "Nektapref",
  "Nektarin nush",
  "Nimba",
  "Plane 741",
  "Plane zummer",
  "Platrina",
  "Platrina 647",
  "Platrina-2",
  "Real glory",
  "Real Gold",
  "Real zummer",
  "Rediks-26",
  "Samanta",
  "Svet lorens",
  "Svet oriana",
  "Skina",
  "Stenliy",
  "UFO-3",
  "UFO-4",
  "Ekstrime",
  "Ekstrime 509",
  "Ekstrime 568",
  "Ekstrime byute",
  "Ekstrime june",
  "Erli fresh",
];

function buildCode(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

async function upsertRootstockTypes(connection) {
  let created = 0;
  let updated = 0;

  for (const [index, name] of rootstockTypes.entries()) {
    const code = buildCode("ROOT", index);
    const description = "Payvandtag turlari katalogidan seed qilindi.";

    const [rows] = await connection.query(
      `SELECT id
       FROM rootstock_types
       WHERE code = ? OR name = ?
       LIMIT 1`,
      [code, name]
    );

    if (rows[0]) {
      await connection.query(
        `UPDATE rootstock_types
         SET name = ?, description = ?
         WHERE id = ?`,
        [name, description, rows[0].id]
      );
      updated += 1;
    } else {
      await connection.query(
        `INSERT INTO rootstock_types (name, code, description)
         VALUES (?, ?, ?)`,
        [name, code, description]
      );
      created += 1;
    }
  }

  return { created, updated };
}

async function upsertSeedlingTypes(connection) {
  let created = 0;
  let updated = 0;

  for (const [index, name] of seedlingTypes.entries()) {
    const code = buildCode("SEEDLING", index);
    const description = "Ko'chat turi katalogidan seed qilindi.";

    const [rows] = await connection.query(
      `SELECT id
       FROM seedling_types
       WHERE code = ? OR name = ?
       LIMIT 1`,
      [code, name]
    );

    if (rows[0]) {
      await connection.query(
        `UPDATE seedling_types
         SET name = ?, description = ?
         WHERE id = ?`,
        [name, description, rows[0].id]
      );
      updated += 1;
    } else {
      await connection.query(
        `INSERT INTO seedling_types (name, code, description)
         VALUES (?, ?, ?)`,
        [name, code, description]
      );
      created += 1;
    }
  }

  return { created, updated };
}

async function upsertVarieties(connection, fallbackSeedlingTypeId) {
  let created = 0;
  let updated = 0;

  for (const [index, name] of varieties.entries()) {
    const code = buildCode("CATVAR", index);
    const description =
      "Hozircha umumiy navlar katalogi sifatida seed qilindi. Keyin mos ko'chat turiga biriktiriladi.";

    const [rows] = await connection.query(
      `SELECT id
       FROM varieties
       WHERE code = ? OR name = ?
       LIMIT 1`,
      [code, name]
    );

    if (rows[0]) {
      await connection.query(
        `UPDATE varieties
         SET name = ?, seedling_type_id = ?, description = ?
         WHERE id = ?`,
        [name, fallbackSeedlingTypeId, description, rows[0].id]
      );
      updated += 1;
    } else {
      await connection.query(
        `INSERT INTO varieties (seedling_type_id, name, code, description)
         VALUES (?, ?, ?, ?)`,
        [fallbackSeedlingTypeId, name, code, description]
      );
      created += 1;
    }
  }

  return { created, updated };
}

async function cleanupPlaceholderCatalog(connection, unknownCatalog) {
  const [placeholderTypes] = await connection.query(
    `SELECT id
     FROM seedling_types
     WHERE name = '*****'
       AND id <> ?`,
    [unknownCatalog.seedlingTypeId]
  );

  for (const row of placeholderTypes) {
    await connection.query(
      `UPDATE varieties
       SET seedling_type_id = ?
       WHERE seedling_type_id = ?`,
      [unknownCatalog.seedlingTypeId, row.id]
    );
    await connection.query(
      `UPDATE seedling_batches
       SET seedling_type_id = ?
       WHERE seedling_type_id = ?`,
      [unknownCatalog.seedlingTypeId, row.id]
    );
    await connection.query(
      `UPDATE orders
       SET seedling_type_id = ?
       WHERE seedling_type_id = ?`,
      [unknownCatalog.seedlingTypeId, row.id]
    );
    await connection.query("DELETE FROM seedling_types WHERE id = ?", [row.id]);
  }

  const [placeholderVarieties] = await connection.query(
    `SELECT id
     FROM varieties
     WHERE name = '*****'
       AND id <> ?`,
    [unknownCatalog.varietyId]
  );

  for (const row of placeholderVarieties) {
    await connection.query(
      `UPDATE seedling_batches
       SET variety_id = ?
       WHERE variety_id = ?`,
      [unknownCatalog.varietyId, row.id]
    );
    await connection.query(
      `UPDATE orders
       SET variety_id = ?
       WHERE variety_id = ?`,
      [unknownCatalog.varietyId, row.id]
    );
    await connection.query("DELETE FROM varieties WHERE id = ?", [row.id]);
  }
}

export async function seedDefaultCatalog(connection, unknownCatalog) {
  const rootstockStats = await upsertRootstockTypes(connection);
  const seedlingStats = await upsertSeedlingTypes(connection);
  const varietyStats = await upsertVarieties(connection, unknownCatalog.seedlingTypeId);

  await cleanupPlaceholderCatalog(connection, unknownCatalog);

  return {
    rootstockStats,
    seedlingStats,
    varietyStats,
  };
}
