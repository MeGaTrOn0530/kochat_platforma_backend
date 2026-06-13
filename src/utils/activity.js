export async function logActivity(executor, payload) {
  const {
    actorUserId = null,
    action,
    entityType,
    entityId,
    description,
    metadata = null
  } = payload;

  const serializedEntityId = String(entityId);
  const serializedMetadata = metadata ? JSON.stringify(metadata) : null;

  try {
    await executor.query(
      `INSERT INTO activity_logs
        (actor_user_id, action, entity_type, entity_id, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actorUserId,
        action,
        entityType,
        serializedEntityId,
        description,
        serializedMetadata
      ]
    );
  } catch (error) {
    const isEntityIdCompatibilityError =
      error?.code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" ||
      error?.code === "WARN_DATA_TRUNCATED" ||
      error?.code === "ER_WARN_DATA_OUT_OF_RANGE" ||
      String(error?.sqlMessage || "").includes("entity_id");

    if (!isEntityIdCompatibilityError) {
      throw error;
    }

    const fallbackMetadata = {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      originalEntityId: serializedEntityId
    };

    await executor.query(
      `INSERT INTO activity_logs
        (actor_user_id, action, entity_type, entity_id, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actorUserId,
        action,
        entityType,
        0,
        description,
        JSON.stringify(fallbackMetadata)
      ]
    );
  }
}
