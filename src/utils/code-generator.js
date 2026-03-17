import { randomBytes } from "crypto";

function randomSuffix(length = 3) {
  return randomBytes(length).toString("hex").toUpperCase();
}

export function generateCode(prefix) {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");

  return `${prefix}-${datePart}-${randomSuffix()}`;
}
