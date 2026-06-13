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

// ─── CORS ────────────────────────────────────────────────────────────────────
// Production da faqat ruxsat etilgan originlar, development da hammasi
const corsOptionsDelegate = (req, callback) => {
  const requestOrigin = req.get("origin");

  // Agar origin yo'q (server-to-server, same-site) — ruxsat
  if (!requestOrigin) {
    return callback(null, {
      origin: true,
      credentials: true,
      methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    });
  }

  // CORS_ORIGIN=* bo'lsa (dev), barcha originlarga ruxsat
  const isAllowed =
    env.corsOrigin === "*" ||
    env.allowedOrigins.some((allowed) =>
      requestOrigin === allowed ||
      requestOrigin.startsWith(allowed.replace(/\/$/, ""))
    );

  return callback(null, {
    origin: isAllowed ? requestOrigin : false,
    credentials: true,
    methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });
};

// ─── Rate limiters ─────────────────────────────────────────────────────────────
// 1. Global: har bir IP dan 300 so'rov/daqiqa
const globalRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => `global:${getRateLimitIp(req)}`,
  message: "Juda ko'p so'rov yuborildi. Biroz kutib qayta urinib ko'ring.",
});

// 2. API write: har bir IP dan 150 so'rov/5 daqiqa (POST/PUT/DELETE)
const writeRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 150,
  keyGenerator: (req) => `write:${getRateLimitIp(req)}`,
  message: "Qisqa vaqt ichida juda ko'p o'zgartirish amali. Keyinroq qayta urinib ko'ring.",
});

// 3. Scan endpoint: 30 so'rov/daqiqa (ochiq endpoint)
const scanRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => `scan:${getRateLimitIp(req)}`,
  message: "Skanerlash so'rovlari juda ko'p.",
});

// ─── Asosiy sozlamalar ─────────────────────────────────────────────────────────
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    referrerPolicy: { policy: "no-referrer" },
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
    crossOriginResourcePolicy: { policy: "cross-origin" },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
  })
);

app.use(cors(corsOptionsDelegate));
app.use(morgan("dev"));

// JSON hajmini cheklash — rasm yuklash uchun 10mb
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// Global rate limit — barcha so'rovlarga
app.use(globalRateLimiter);

app.use("/uploads", express.static(getUploadRoot(), { index: false }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ success: true, message: "Server ishlayapti" });
});

// ─── QR Scan — ochiq, lekin rate limited ─────────────────────────────────────
app.get("/scan/:code", scanRateLimiter, async (req, res) => {
  const { getPool } = await import("./config/database.js");
  const code = String(req.params.code || "").trim();

  // Faqat ruxsat etilgan belgilar (alphanumeric + - _)
  if (!code || !/^[\w\-]{1,80}$/.test(code)) {
    return res.status(400).send(buildScanHtml({
      title: "Noto'g'ri kod",
      items: [{ label: "Xato", value: "Kod formati noto'g'ri" }],
      type: "error",
    }));
  }

  try {
    const pool = getPool();

    const [batches] = await pool.query(
      `SELECT b.id, b.batch_code, b.received_date, b.initial_quantity, b.notes,
              si.current_stage, si.quantity_available, si.defect_quantity,
              st.name AS seedling_type_name, v.name AS variety_name,
              rt.name AS rootstock_type_name, l.name AS location_name
       FROM seedling_batches b
       LEFT JOIN seedling_inventory si ON si.batch_id = b.id
       LEFT JOIN seedling_types st ON st.id = b.seedling_type_id
       LEFT JOIN varieties v ON v.id = b.variety_id
       LEFT JOIN rootstock_types rt ON rt.id = b.rootstock_type_id
       LEFT JOIN locations l ON l.id = si.location_id
       WHERE b.batch_code = ? ORDER BY si.id DESC LIMIT 1`,
      [code]
    );

    if (!batches.length) {
      const [units] = await pool.query(
        `SELECT u.unit_code, u.unit_number, u.current_stage, u.is_defective,
                b.batch_code, b.received_date,
                st.name AS seedling_type_name, v.name AS variety_name,
                l.name AS location_name
         FROM seedling_units u
         JOIN seedling_batches b ON b.id = u.batch_id
         LEFT JOIN seedling_types st ON st.id = b.seedling_type_id
         LEFT JOIN varieties v ON v.id = b.variety_id
         LEFT JOIN seedling_inventory si ON si.batch_id = b.id
         LEFT JOIN locations l ON l.id = si.location_id
         WHERE u.unit_code = ? LIMIT 1`,
        [code]
      );

      if (units.length) {
        const u = units[0];
        const stageLabels = { cassette: "Kasetada", sown: "Tuvakda", grafting: "Payvantlash", grafted: "Payvantlangan", ready: "Ko'chat (tayyor)" };
        return res.send(buildScanHtml({
          title: `Ko'chat dona: ${u.unit_code}`,
          items: [
            { label: "Dona kodi", value: u.unit_code },
            { label: "Partiya", value: u.batch_code },
            { label: "Bosqich", value: stageLabels[u.current_stage] || u.current_stage },
            { label: "Holat", value: u.is_defective ? "⚠️ Nuqsonli" : "✅ Barkamol" },
            { label: "Tur", value: u.seedling_type_name || "—" },
            { label: "Nav", value: u.variety_name || "—" },
            { label: "Lokatsiya", value: u.location_name || "—" },
            { label: "Kirim sanasi", value: u.received_date ? new Date(u.received_date).toLocaleDateString("uz-UZ") : "—" },
          ],
          type: "unit",
        }));
      }

      return res.status(404).send(buildScanHtml({
        title: "Topilmadi",
        items: [{ label: "Xato", value: "Ko'rsatilgan kod tizimda yo'q" }],
        type: "error",
      }));
    }

    const b = batches[0];
    const stageLabels = { cassette: "Kasetada", sown: "Tuvakda", grafting: "Payvantlash", grafted: "Payvantlangan", ready: "Ko'chat (tayyor)" };
    return res.send(buildScanHtml({
      title: `Partiya: ${b.batch_code}`,
      items: [
        { label: "Partiya kodi", value: b.batch_code },
        { label: "Bosqich", value: stageLabels[b.current_stage] || b.current_stage || "—" },
        { label: "Jami", value: `${b.initial_quantity || 0} ta` },
        { label: "Mavjud", value: `${b.quantity_available || 0} ta` },
        { label: "Nuqsonli", value: `${b.defect_quantity || 0} ta` },
        { label: "Tur", value: b.seedling_type_name || "—" },
        { label: "Nav", value: b.variety_name || "—" },
        { label: "Payvandtag", value: b.rootstock_type_name || "—" },
        { label: "Lokatsiya", value: b.location_name || "—" },
        { label: "Kirim sanasi", value: b.received_date ? new Date(b.received_date).toLocaleDateString("uz-UZ") : "—" },
        { label: "Izoh", value: b.notes || "—" },
      ],
      type: "batch",
    }));
  } catch (_err) {
    // Server xatosi tafsilotlarini tashqariga chiqarmaymiz
    return res.status(500).send(buildScanHtml({
      title: "Xatolik",
      items: [{ label: "Xabar", value: "Vaqtinchalik muammo yuz berdi. Keyinroq urinib ko'ring." }],
      type: "error",
    }));
  }
});

function buildScanHtml({ title, items, type }) {
  const color = type === "batch" ? "#15803d" : type === "unit" ? "#1d4ed8" : "#dc2626";
  const rows = items.map(i => `<tr><td class="label">${i.label}</td><td class="value">${i.value}</td></tr>`).join("");
  return `<!DOCTYPE html><html lang="uz"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f0fdf4;min-height:100vh;padding:16px}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:480px;margin:0 auto;overflow:hidden}
.header{background:${color};color:#fff;padding:20px;text-align:center}
.header h1{font-size:18px;font-weight:700;margin-bottom:4px}
.header p{font-size:12px;opacity:.8}
table{width:100%;border-collapse:collapse}
tr{border-bottom:1px solid #f0f0f0}tr:last-child{border:none}
.label{padding:12px 16px;font-size:12px;color:#6b7280;width:40%}
.value{padding:12px 16px;font-size:14px;font-weight:600;color:#111827}
.footer{padding:12px;text-align:center;font-size:11px;color:#9ca3af}
</style>
</head><body>
<div class="card">
<div class="header"><h1>${title}</h1><p>Ko'chat boshqaruv tizimi</p></div>
<table>${rows}</table>
<div class="footer">Kochat Platforma • ${new Date().toLocaleString("uz-UZ")}</div>
</div></body></html>`;
}

// ─── API ───────────────────────────────────────────────────────────────────────
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
