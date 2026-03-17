import AppError from "./app-error.js";

export function requireFields(payload, fields) {
  const missing = fields.filter((field) => {
    const value = payload[field];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new AppError(`Majburiy maydonlar yo'q: ${missing.join(", ")}`, 400);
  }
}

export function toPositiveInt(value, fieldName) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} musbat butun son bo'lishi kerak.`, 400);
  }

  return parsed;
}

export function toInteger(value, fieldName, defaultValue = 0) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    throw new AppError(`${fieldName} butun son bo'lishi kerak.`, 400);
  }

  return parsed;
}

export function toNullableInt(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return toPositiveInt(value, fieldName);
}

export function toNumber(value, fieldName, defaultValue = 0) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new AppError(`${fieldName} son bo'lishi kerak.`, 400);
  }

  return parsed;
}

export function toBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}
