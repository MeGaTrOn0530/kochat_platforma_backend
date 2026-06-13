import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import AppError from "./app-error.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const UPLOAD_ROOT = path.join(BACKEND_ROOT, "uploads");

const MIME_EXTENSION_MAP = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function hasValidMagicBytes(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false;
  }

  switch (mimeType) {
    case "image/jpeg":
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/png":
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    case "image/gif":
      return buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
        buffer.subarray(0, 6).toString("ascii") === "GIF89a";
    case "image/webp":
      return (
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
      );
    default:
      return false;
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new AppError("Rasm formati noto'g'ri.", 400);
  }

  const mimeType = match[1].toLowerCase();
  const base64Payload = match[2];
  const extension = MIME_EXTENSION_MAP[mimeType];

  if (!extension) {
    throw new AppError("Faqat jpg, png, webp yoki gif rasm yuklash mumkin.", 400);
  }

  const buffer = Buffer.from(base64Payload, "base64");

  if (!hasValidMagicBytes(buffer, mimeType)) {
    throw new AppError("Rasm fayli buzilgan yoki soxta formatda yuborilgan.", 400);
  }

  return {
    mimeType,
    extension,
    buffer,
  };
}

export function getUploadRoot() {
  return UPLOAD_ROOT;
}

export function resolveUploadedFilePath(publicPath) {
  const normalizedPath = String(publicPath || "").trim();

  if (!normalizedPath.startsWith("/uploads/")) {
    throw new AppError("Yuklangan fayl manzili noto'g'ri.", 400);
  }

  const relativePath = normalizedPath.replace(/^\/uploads\//, "");
  const absolutePath = path.resolve(UPLOAD_ROOT, relativePath);
  const normalizedRoot = path.resolve(UPLOAD_ROOT);

  if (!absolutePath.startsWith(`${normalizedRoot}${path.sep}`) && absolutePath !== normalizedRoot) {
    throw new AppError("Yuklangan fayl manzili xavfsiz emas.", 400);
  }

  return absolutePath;
}

async function saveImages(files = [], bucketName, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  if (files.length > 5) {
    throw new AppError("Bir bosqich uchun ko'pi bilan 5 ta rasm yuklash mumkin.", 400);
  }

  const folderName = new Date().toISOString().slice(0, 10);
  const targetDir = path.join(UPLOAD_ROOT, bucketName, folderName);
  await fs.mkdir(targetDir, { recursive: true });

  const writtenFiles = [];

  try {
    for (const file of files) {
      const parsed = parseDataUrl(file?.dataUrl);

      if (parsed.buffer.byteLength > 5 * 1024 * 1024) {
        throw new AppError("Har bir rasm 5MB dan katta bo'lmasligi kerak.", 400);
      }

      const safeBaseName =
        String(file?.name || options?.prefix || "seedling")
          .replace(/[^a-zA-Z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "seedling";

      const fileName = `${safeBaseName}-${crypto.randomUUID()}${parsed.extension}`;
      const absolutePath = path.join(targetDir, fileName);
      await fs.writeFile(absolutePath, parsed.buffer);

      const publicPath = `/uploads/${bucketName}/${folderName}/${fileName}`;
      writtenFiles.push({
        absolutePath,
        publicPath,
      });
    }
  } catch (error) {
    await Promise.all(
      writtenFiles.map((file) => fs.unlink(file.absolutePath).catch(() => undefined))
    );
    throw error;
  }

  return writtenFiles.map((file) => file.publicPath);
}

export async function saveSeedlingImages(files = [], options = {}) {
  return saveImages(files, "seedlings", options);
}

export async function saveCustomerProductImages(files = [], options = {}) {
  return saveImages(files, "customer-products", options);
}

export async function saveProfileImages(files = [], options = {}) {
  return saveImages(files, "profiles", options);
}

export async function removeUploadedFiles(publicPaths = []) {
  if (!Array.isArray(publicPaths) || publicPaths.length === 0) {
    return;
  }

  await Promise.all(
    publicPaths.map(async (publicPath) => {
      const normalizedPath = String(publicPath || "").trim();

      if (!normalizedPath.startsWith("/uploads/")) {
        return;
      }

      const absolutePath = resolveUploadedFilePath(normalizedPath);
      await fs.unlink(absolutePath).catch(() => undefined);
    })
  );
}
