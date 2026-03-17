import jwt from "jsonwebtoken";
import AppError from "../utils/app-error.js";

const { JsonWebTokenError, TokenExpiredError } = jwt;

export function notFoundHandler(req, res, next) {
  next(new AppError(`Route topilmadi: ${req.method} ${req.originalUrl}`, 404));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      details: error.details || null
    });
  }

  if (error instanceof TokenExpiredError) {
    return res.status(401).json({
      success: false,
      message: "Sessiya muddati tugagan. Qayta login qiling."
    });
  }

  if (error instanceof JsonWebTokenError) {
    return res.status(401).json({
      success: false,
      message: "Token noto'g'ri yoki buzilgan."
    });
  }

  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      success: false,
      message: "Unique qiymat takrorlangan.",
      details: error.sqlMessage
    });
  }

  if (error?.code === "ER_NO_REFERENCED_ROW_2") {
    const sqlMessage = String(error?.sqlMessage || "");
    let message = "Bog'langan ma'lumot topilmadi.";

    if (sqlMessage.includes("fk_orders_batch")) {
      message = "Tanlangan partiya bazada topilmadi.";
    } else if (sqlMessage.includes("fk_orders_seedling_type")) {
      message = "Tanlangan ko'chat turi bazada topilmadi.";
    } else if (sqlMessage.includes("fk_orders_variety")) {
      message = "Tanlangan nav buyurtma katalogiga ulanmagan.";
    } else if (sqlMessage.includes("fk_orders_created_by")) {
      message = "Buyurtma yaratayotgan foydalanuvchi topilmadi. Qayta login qiling.";
    } else if (sqlMessage.includes("order_items_ibfk_1")) {
      message = "Buyurtma yozuvi yaratilmadi, itemlarni ulab bo'lmadi.";
    } else if (sqlMessage.includes("order_items_ibfk_2")) {
      message = "Tanlangan partiya yozuvi topilmadi.";
    } else if (sqlMessage.includes("order_items_ibfk_3")) {
      message = "Tanlangan partiya inventari topilmadi.";
    }

    return res.status(400).json({
      success: false,
      message,
      details: error.sqlMessage
    });
  }

  if (error?.code === "ER_ROW_IS_REFERENCED_2") {
    return res.status(409).json({
      success: false,
      message: "Bu yozuv boshqa ma'lumotlar bilan bog'langanligi sababli o'chirib bo'lmaydi.",
      details: error.sqlMessage
    });
  }

  console.error(error);

  return res.status(500).json({
    success: false,
    message: "Server xatoligi yuz berdi."
  });
}
