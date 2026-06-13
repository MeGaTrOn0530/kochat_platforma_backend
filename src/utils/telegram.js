/**
 * telegram.js
 * Telegram Bot API orqali xabar yuborish xizmati.
 * Foydalanuvchilar o'z chat_id va sozlamalarini telegram_settings jadvalida saqlaydi.
 */
import env from "../config/env.js";

const TELEGRAM_API = `https://api.telegram.org/bot${env.telegramBotToken}`;

function formatMoney(amount) {
  return new Intl.NumberFormat("uz-UZ").format(Number(amount || 0));
}

/**
 * Bitta chat_id ga xabar yuboradi.
 * Xato bo'lsa log qiladi, lekin asosiy jarayonni to'xtatmaydi.
 */
async function sendToChat(chatId, text) {
  if (!env.telegramBotToken || !chatId) return;

  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn(`[Telegram] chatId=${chatId} xato:`, err.description || res.status);
    }
  } catch (e) {
    console.warn("[Telegram] Ulanish xatosi:", e.message);
  }
}

/**
 * Barcha aktiv telegram_settings foydalanuvchilarga,
 * agar ularning tegishli bildirishnoma turi yoqilgan bo'lsa, xabar yuboradi.
 *
 * @param {object} pool - MySQL connection pool
 * @param {string} notifyField - 'notify_new_order' | 'notify_order_sold' | 'notify_transfer' | 'notify_low_stock'
 * @param {string} text - Telegram HTML xabari
 */
export async function sendTelegramNotification(pool, notifyField, text) {
  if (!env.telegramBotToken) return;

  try {
    const [rows] = await pool.query(
      `SELECT telegram_chat_id
       FROM telegram_settings
       WHERE is_active = 1
         AND telegram_chat_id IS NOT NULL
         AND telegram_chat_id != ''
         AND \`${notifyField}\` = 1`
    );

    for (const row of rows) {
      await sendToChat(row.telegram_chat_id, text);
    }
  } catch (e) {
    console.warn("[Telegram] DB xatosi:", e.message);
  }
}

// ─── Tayyor xabar shablonlari ────────────────────────────────────────────────

export function msgNewOrder({ orderNumber, customerName, quantity, totalAmount, locationName }) {
  return (
    `📦 <b>Yangi buyurtma!</b>\n\n` +
    `🔢 Raqam: <code>${orderNumber}</code>\n` +
    `👤 Mijoz: <b>${customerName}</b>\n` +
    `🌱 Miqdor: <b>${quantity} ta</b>\n` +
    `💰 Summa: <b>${formatMoney(totalAmount)} so'm</b>\n` +
    `📍 Lokatsiya: ${locationName || "—"}\n` +
    `🕐 Sana: ${new Date().toLocaleString("uz-UZ")}`
  );
}

export function msgOrderSold({ orderNumber, customerName, quantity, totalAmount, soldByName }) {
  return (
    `✅ <b>Buyurtma sotildi!</b>\n\n` +
    `🔢 Raqam: <code>${orderNumber}</code>\n` +
    `👤 Mijoz: <b>${customerName}</b>\n` +
    `🌱 Miqdor: <b>${quantity} ta</b>\n` +
    `💰 Summa: <b>${formatMoney(totalAmount)} so'm</b>\n` +
    `👨‍💼 Sotgan: ${soldByName || "—"}\n` +
    `🕐 Sana: ${new Date().toLocaleString("uz-UZ")}`
  );
}

export function msgNewTransfer({ batchCode, fromLocation, toLocation, quantity, createdByName }) {
  return (
    `🔄 <b>Yangi transfer!</b>\n\n` +
    `📦 Partiya: <code>${batchCode}</code>\n` +
    `📤 Qayerdan: <b>${fromLocation}</b>\n` +
    `📥 Qayerga: <b>${toLocation}</b>\n` +
    `🌱 Miqdor: <b>${quantity} ta</b>\n` +
    `👨‍💼 Yaratgan: ${createdByName || "—"}\n` +
    `🕐 Sana: ${new Date().toLocaleString("uz-UZ")}`
  );
}

export function msgLowStock({ locationName, batchCode, available, seedlingType }) {
  return (
    `⚠️ <b>Kam qolgan stok!</b>\n\n` +
    `📍 Lokatsiya: <b>${locationName}</b>\n` +
    `📦 Partiya: <code>${batchCode}</code>\n` +
    `🌱 Tur: ${seedlingType || "—"}\n` +
    `🔢 Qolgan: <b>${available} ta</b>\n` +
    `🕐 Sana: ${new Date().toLocaleString("uz-UZ")}`
  );
}

export function msgNewPayment({ orderNumber, customerName, amount, paymentMethod }) {
  const methodLabel = { cash: "Naqd", card: "Karta", transfer: "Bank o'tkazmasi" };
  return (
    `💵 <b>To'lov qabul qilindi!</b>\n\n` +
    `🔢 Buyurtma: <code>${orderNumber}</code>\n` +
    `👤 Mijoz: <b>${customerName}</b>\n` +
    `💰 Miqdor: <b>${formatMoney(amount)} so'm</b>\n` +
    `💳 Usul: ${methodLabel[paymentMethod] || paymentMethod}\n` +
    `🕐 Sana: ${new Date().toLocaleString("uz-UZ")}`
  );
}
