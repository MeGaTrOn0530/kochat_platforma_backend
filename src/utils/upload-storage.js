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

  return {
    mimeType,
    extension,
    buffer: Buffer.from(base64Payload, "base64"),
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
