import { fetchOne } from "./db-helpers.js";

export async function createNotifications(executor, recipientIds, payload) {
  const uniqueRecipientIds = [...new Set((recipientIds || []).map((id) => Number(id)).filter(Boolean))];

  if (!uniqueRecipientIds.length) {
    return 0;
  }

  const values = uniqueRecipientIds.map((recipientUserId) => [
    recipientUserId,
    payload.type || "info",
    payload.title,
    payload.message,
    payload.entityType || null,
    payload.entityId || null,
    payload.locationId || null,
    payload.createdBy || null,
  ]);

  const [result] = await executor.query(
    `INSERT INTO notifications
      (recipient_user_id, type, title, message, entity_type, entity_id, location_id, created_by)
     VALUES ?`,
    [values]
  );

  return result.affectedRows || uniqueRecipientIds.length;
}

export async function getOrderNotificationRecipientIds(executor, locationId) {
  return getNotificationRecipientIds(executor, {
    roles: ["admin", "bosh_agranom", "bugalter"],
    locationIds: [locationId],
    includeAgranomsForLocations: true,
  });
}

export async function getUnreadNotificationsCount(executor, recipientUserId) {
  const row = await fetchOne(
    executor,
    `SELECT COUNT(*) AS total
     FROM notifications
     WHERE recipient_user_id = ?
       AND is_read = 0`,
    [recipientUserId]
  );

  return Number(row?.total || 0);
}

export async function getNotificationRecipientIds(executor, options = {}) {
  const {
    roles = [],
    locationIds = [],
    includeAgranomsForLocations = false,
    userIds = [],
    excludeUserIds = [],
  } = options;

  const clauses = [];
  const params = [];
  const normalizedLocationIds = [...new Set((locationIds || []).map((id) => Number(id)).filter(Boolean))];
  const normalizedUserIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  const normalizedExcludeUserIds = [...new Set((excludeUserIds || []).map((id) => Number(id)).filter(Boolean))];

  if (roles.length > 0) {
    clauses.push(`role IN (${roles.map(() => "?").join(", ")})`);
    params.push(...roles);
  }

  if (includeAgranomsForLocations && normalizedLocationIds.length > 0) {
    clauses.push(`(role = 'agranom' AND location_id IN (${normalizedLocationIds.map(() => "?").join(", ")}))`);
    params.push(...normalizedLocationIds);
  }

  if (normalizedUserIds.length > 0) {
    clauses.push(`id IN (${normalizedUserIds.map(() => "?").join(", ")})`);
    params.push(...normalizedUserIds);
  }

  if (!clauses.length) {
    return [];
  }

  let sql = `SELECT DISTINCT id
             FROM users
             WHERE status = 'active'
               AND (${clauses.join(" OR ")})`;

  if (normalizedExcludeUserIds.length > 0) {
    sql += ` AND id NOT IN (${normalizedExcludeUserIds.map(() => "?").join(", ")})`;
    params.push(...normalizedExcludeUserIds);
  }

  const [rows] = await executor.query(sql, params);
  return rows.map((row) => row.id);
}

export async function getSeedlingApprovalRecipientIds(executor, excludeUserIds = []) {
  return getNotificationRecipientIds(executor, {
    roles: ["admin", "bosh_agranom"],
    excludeUserIds,
  });
}

export async function getTransferNotificationRecipientIds(executor, locationIds = [], excludeUserIds = []) {
  return getNotificationRecipientIds(executor, {
    roles: ["admin", "bosh_agranom", "bugalter"],
    locationIds,
    includeAgranomsForLocations: true,
    excludeUserIds,
  });
}
