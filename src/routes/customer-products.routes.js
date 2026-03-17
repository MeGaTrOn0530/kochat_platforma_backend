import { Router } from "express";
import { getPool, withTransaction } from "../config/database.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import AppError from "../utils/app-error.js";
import asyncHandler from "../utils/async-handler.js";
import { buildUpdateColumns, fetchOne } from "../utils/db-helpers.js";
import { sendCreated, sendOk } from "../utils/http.js";
import { logActivity } from "../utils/activity.js";
import {
  removeUploadedFiles,
  saveCustomerProductImages,
} from "../utils/upload-storage.js";
import { requireFields, toBoolean, toInteger, toNumber, toPositiveInt } from "../utils/validation.js";

const router = Router();

function normalizePrice(value) {
  const parsed = toNumber(value, "price");

  if (parsed < 0) {
    throw new AppError("Narx manfiy bo'lmasligi kerak.", 400);
  }

  return Number(parsed.toFixed(2));
}

router.get(
  "/public",
  asyncHandler(async (_req, res) => {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, name, description, price, image_path, is_active, display_order, created_at, updated_at
       FROM customer_products
       WHERE is_active = 1
       ORDER BY display_order ASC, id DESC`
    );

    return sendOk(res, rows);
  })
);

router.use(authenticate);
router.use(authorize("admin"));

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT cp.*,
              cu.full_name AS created_by_name,
              uu.full_name AS updated_by_name
       FROM customer_products cp
       LEFT JOIN users cu ON cu.id = cp.created_by
       LEFT JOIN users uu ON uu.id = cp.updated_by
       ORDER BY cp.display_order ASC, cp.id DESC`
    );

    return sendOk(res, rows);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    requireFields(req.body, ["name", "price", "image"]);

    const imagePaths = await saveCustomerProductImages([req.body.image], {
      prefix: req.body.name,
    });

    try {
      const result = await withTransaction(async (conn) => {
        const [insertResult] = await conn.query(
          `INSERT INTO customer_products
            (name, description, price, image_path, is_active, display_order, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(req.body.name).trim(),
            req.body.description?.trim() || null,
            normalizePrice(req.body.price),
            imagePaths[0] || null,
            toBoolean(req.body.isActive, true) ? 1 : 0,
            toInteger(req.body.displayOrder, "displayOrder", 0),
            req.user.id,
            req.user.id,
          ]
        );

        const createdRow = await fetchOne(
          conn,
          "SELECT * FROM customer_products WHERE id = ? LIMIT 1",
          [insertResult.insertId]
        );

        await logActivity(conn, {
          actorUserId: req.user.id,
          action: "customer_product_created",
          entityType: "customer_product",
          entityId: insertResult.insertId,
          description: `${req.body.name} mijoz kartasi yaratildi`,
        });

        return createdRow;
      });

      return sendCreated(res, result, "Mijoz kartasi yaratildi.");
    } catch (error) {
      await removeUploadedFiles(imagePaths);
      throw error;
    }
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const productId = toPositiveInt(req.params.id, "productId");
    const existingProduct = await fetchOne(
      pool,
      "SELECT * FROM customer_products WHERE id = ? LIMIT 1",
      [productId]
    );

    if (!existingProduct) {
      throw new AppError("Mijoz kartasi topilmadi.", 404);
    }

    let newImagePaths = [];

    if (req.body.image) {
      newImagePaths = await saveCustomerProductImages([req.body.image], {
        prefix: req.body.name || existingProduct.name,
      });
    }

    try {
      const result = await withTransaction(async (conn) => {
        const updates = buildUpdateColumns({
          name: req.body.name !== undefined ? String(req.body.name).trim() : undefined,
          description: req.body.description !== undefined ? req.body.description?.trim() || null : undefined,
          price: req.body.price !== undefined ? normalizePrice(req.body.price) : undefined,
          is_active: req.body.isActive !== undefined ? (toBoolean(req.body.isActive) ? 1 : 0) : undefined,
          display_order:
            req.body.displayOrder !== undefined
              ? toInteger(req.body.displayOrder, "displayOrder", 0)
              : undefined,
          image_path: newImagePaths[0] || undefined,
          updated_by: req.user.id,
        });

        if (!updates.hasValues) {
          throw new AppError("Yangilash uchun kamida bitta maydon yuboring.", 400);
        }

        await conn.query(
          `UPDATE customer_products
           SET ${updates.sql}
           WHERE id = ?`,
          [...updates.values, productId]
        );

        await logActivity(conn, {
          actorUserId: req.user.id,
          action: "customer_product_updated",
          entityType: "customer_product",
          entityId: productId,
          description: `${existingProduct.name} mijoz kartasi yangilandi`,
        });

        return fetchOne(conn, "SELECT * FROM customer_products WHERE id = ? LIMIT 1", [productId]);
      });

      if (newImagePaths[0] && existingProduct.image_path) {
        await removeUploadedFiles([existingProduct.image_path]);
      }

      return sendOk(res, result, "Mijoz kartasi yangilandi.");
    } catch (error) {
      await removeUploadedFiles(newImagePaths);
      throw error;
    }
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const productId = toPositiveInt(req.params.id, "productId");

    const deletedProduct = await withTransaction(async (conn) => {
      const existingProduct = await fetchOne(
        conn,
        "SELECT * FROM customer_products WHERE id = ? LIMIT 1",
        [productId]
      );

      if (!existingProduct) {
        throw new AppError("Mijoz kartasi topilmadi.", 404);
      }

      await conn.query("DELETE FROM customer_products WHERE id = ?", [productId]);

      await logActivity(conn, {
        actorUserId: req.user.id,
        action: "customer_product_deleted",
        entityType: "customer_product",
        entityId: productId,
        description: `${existingProduct.name} mijoz kartasi o'chirildi`,
      });

      return existingProduct;
    });

    if (deletedProduct?.image_path) {
      await removeUploadedFiles([deletedProduct.image_path]);
    }

    return sendOk(res, null, "Mijoz kartasi o'chirildi.");
  })
);

export default router;
