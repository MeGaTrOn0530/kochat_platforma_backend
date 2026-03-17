import dotenv from "dotenv";
import { assertSecureProductionEnv, parseAllowedOrigins } from "../utils/security.js";

dotenv.config();

function toBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

function toInteger(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: toInteger(process.env.PORT, 5000),
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: toInteger(process.env.DB_PORT, 3306),
  dbUser: process.env.DB_USER || "root",
  dbPassword: process.env.DB_PASSWORD || "",
  dbName: process.env.DB_NAME || "kochat_platform",
  jwtSecret: process.env.JWT_SECRET || "change_me_in_production",
  jwtExpiresHours: toInteger(process.env.JWT_EXPIRES_HOURS, 8),
  cookieName: process.env.COOKIE_NAME || "kochat_token",
  corsOrigin:
    process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173",
  autoInitDb: toBoolean(process.env.AUTO_INIT_DB, true),
  defaultAdminFullName: process.env.DEFAULT_ADMIN_FULL_NAME || "System Admin",
  defaultAdminUsername: process.env.DEFAULT_ADMIN_USERNAME || "",
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || "",
  defaultLocationName: process.env.DEFAULT_LOCATION_NAME || "Markaziy Ombor",
  defaultLocationCode: process.env.DEFAULT_LOCATION_CODE || "HQ"
};

env.allowedOrigins = parseAllowedOrigins(env.corsOrigin);

assertSecureProductionEnv(env);

export default env;
