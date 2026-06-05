import { createHmac } from "crypto";
import env from "../config/env.js";

const QR_PREFIX = "KOCHAT-BATCH-QR:v1:";
const BARCODE_PREFIX = "KOCHAT-BATCH-BAR:v1:";
const PAYLOAD_VERSION = 1;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function signEncodedPayload(scope, encodedPayload) {
  return createHmac("sha256", env.jwtSecret)
    .update(`${scope}:${encodedPayload}`)
    .digest("base64url")
    .slice(0, 24);
}

function encodePayload(payload) {
  return Buffer.from(stableStringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload) {
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeLabelCodeType(value) {
  return String(value || "").trim().toLowerCase() === "barcode" ? "barcode" : "qr";
}

export function buildSeedlingBatchCodePayload(batch = {}) {
  return {
    v: PAYLOAD_VERSION,
    entity: "seedling_batch",
    batchId: toNullableNumber(batch.batchId ?? batch.batch_id ?? batch.id),
    batchCode: toNullableString(batch.batchCode ?? batch.batch_code ?? batch.batchNumber),
    labelCodeType: normalizeLabelCodeType(batch.labelCodeType ?? batch.label_code_type),
    quantity: toNullableNumber(
      batch.quantity ??
        batch.initial_quantity ??
        batch.initialQuantity ??
        batch.quantity_available ??
        batch.healthyQuantity
    ),
    receivedAt: toNullableString(
      batch.receivedAt ??
        batch.received_at_exact ??
        batch.batch_created_at ??
        batch.created_at ??
        batch.received_date
    ),
    receivedDate: toNullableString(batch.receivedDate ?? batch.received_date),
    locationId: toNullableNumber(
      batch.locationId ?? batch.location_id ?? batch.source_location_id ?? batch.sourceLocationId
    ),
    locationName: toNullableString(
      batch.locationName ?? batch.location_name ?? batch.source_location_name ?? batch.sourceLocationName
    ),
    seedlingTypeId: toNullableNumber(batch.seedlingTypeId ?? batch.seedling_type_id),
    seedlingTypeName: toNullableString(batch.seedlingTypeName ?? batch.seedling_type_name),
    varietyId: toNullableNumber(batch.varietyId ?? batch.variety_id),
    varietyName: toNullableString(batch.varietyName ?? batch.variety_name),
    rootstockTypeId: toNullableNumber(batch.rootstockTypeId ?? batch.rootstock_type_id),
    rootstockTypeName: toNullableString(batch.rootstockTypeName ?? batch.rootstock_type_name),
    notes: toNullableString(batch.notes) || "",
  };
}

function buildBarcodeLookupPayload(batch = {}) {
  return {
    v: PAYLOAD_VERSION,
    entity: "seedling_batch_lookup",
    batchId: toNullableNumber(batch.batchId ?? batch.batch_id ?? batch.id),
    batchCode: toNullableString(batch.batchCode ?? batch.batch_code ?? batch.batchNumber),
  };
}

export function encodeSeedlingBatchQrCode(batch = {}) {
  const payload = buildSeedlingBatchCodePayload(batch);
  const encodedPayload = encodePayload(payload);
  const signature = signEncodedPayload("qr", encodedPayload);

  return `${QR_PREFIX}${encodedPayload}.${signature}`;
}

export function encodeSeedlingBatchBarcode(batch = {}) {
  const payload = buildBarcodeLookupPayload(batch);
  const encodedPayload = encodePayload(payload);
  const signature = signEncodedPayload("barcode", encodedPayload);

  return `${BARCODE_PREFIX}${encodedPayload}.${signature}`;
}

function parseSignedCode(rawValue, prefix, scope) {
  if (!rawValue.startsWith(prefix)) {
    return null;
  }

  const signedPayload = rawValue.slice(prefix.length);
  const separatorIndex = signedPayload.lastIndexOf(".");

  if (separatorIndex <= 0) {
    return null;
  }

  const encodedPayload = signedPayload.slice(0, separatorIndex);
  const signature = signedPayload.slice(separatorIndex + 1);
  const expectedSignature = signEncodedPayload(scope, encodedPayload);

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    return decodePayload(encodedPayload);
  } catch {
    return null;
  }
}

export function parseSeedlingBatchCode(rawValue) {
  const normalizedValue = String(rawValue || "").trim();

  if (!normalizedValue) {
    return null;
  }

  const qrPayload = parseSignedCode(normalizedValue, QR_PREFIX, "qr");

  if (qrPayload) {
    return {
      codeType: "qr",
      payload: qrPayload,
      rawValue: normalizedValue,
    };
  }

  const barcodePayload = parseSignedCode(normalizedValue, BARCODE_PREFIX, "barcode");

  if (barcodePayload) {
    return {
      codeType: "barcode",
      payload: barcodePayload,
      rawValue: normalizedValue,
    };
  }

  return {
    codeType: "barcode",
    payload: {
      entity: "seedling_batch_lookup",
      batchCode: normalizedValue,
    },
    rawValue: normalizedValue,
  };
}

export function buildSeedlingBatchCodeArtifacts(batch = {}) {
  const labelCodeType = normalizeLabelCodeType(batch.labelCodeType ?? batch.label_code_type);
  // QR payload — faqat batch kodi (qisqa, kamera oson o'qiydi)
  const batchCode = toNullableString(
    batch.batchCode ?? batch.batch_code ?? batch.batchNumber
  );
  const qrPayload = batchCode || encodeSeedlingBatchQrCode(batch);

  return {
    labelCodeType,
    qrPayload,
    barcodeValue:
      toNullableString(batch.barcodeValue ?? batch.barcode_value) || encodeSeedlingBatchBarcode(batch),
  };
}
