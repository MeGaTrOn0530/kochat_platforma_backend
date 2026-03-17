const ROLE_ALIASES = {
  admin: "admin",
  head: "bosh_agranom",
  bosh_agranom: "bosh_agranom",
  accountant: "bugalter",
  bugalter: "bugalter",
  operator: "agranom",
  agronom: "agranom",
  agranom: "agranom",
  manager: "manager"
};

export function normalizeRole(role) {
  const key = String(role || "").trim().toLowerCase();
  return ROLE_ALIASES[key] || key || null;
}

export function hasAnyRole(role, allowedRoles = []) {
  const normalizedRole = normalizeRole(role);
  return allowedRoles.some((allowedRole) => normalizeRole(allowedRole) === normalizedRole);
}

export function toPublicUser(user) {
  const fullName = user?.full_name ?? user?.fullName ?? user?.name ?? null;
  const locationId = user?.location_id ?? user?.locationId ?? null;
  const avatarPath = user?.avatar_path ?? user?.avatarPath ?? null;

  return {
    id: user?.id ?? null,
    fullName,
    name: fullName,
    username: user?.username ?? null,
    email: user?.email ?? null,
    phone: user?.phone ?? null,
    role: normalizeRole(user?.role),
    locationId,
    avatarPath,
    status: user?.status ?? null
  };
}
