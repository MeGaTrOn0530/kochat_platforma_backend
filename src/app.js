import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import env from "./config/env.js";
import apiRouter from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { createRateLimiter, getRateLimitIp } from "./middlewares/rate-limit.middleware.js";
import { attachApiSecurityHeaders, requireTrustedOrigin } from "./middlewares/request-security.middleware.js";
import { isSafeMethod } from "./utils/security.js";
import { getUploadRoot } from "./utils/upload-storage.js";

const app = express();

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (env.corsOrigin === "*") {
      return callback(null, true);
    }

    if (env.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS origin ruxsat etilmagan."));
  },
  credentials: true,
  methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

const writeRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => `${getRateLimitIp(req)}:write`,
  message: "Qisqa vaqt ichida juda ko'p yozish amali yuborildi. Keyinroq qayta urinib ko'ring.",
});

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    referrerPolicy: {
      policy: "no-referrer",
    },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", ...env.allowedOrigins],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);
app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use("/uploads", express.static(getUploadRoot(), { index: false }));

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server ishlayapti"
  });
});

app.use(
  "/api",
  attachApiSecurityHeaders,
  (req, res, next) => (isSafeMethod(req.method) ? next() : writeRateLimiter(req, res, next)),
  requireTrustedOrigin,
  apiRouter
);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
