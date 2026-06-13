import TelegramBot from "node-telegram-bot-api";
import { getPool } from "../config/database.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

let botInstance = null;

const userStates = new Map();   // chatId -> { step, ... }
const pendingChats = new Map(); // customerChatId -> { name, msgs: [] }
const chatSessions = new Map(); // customerChatId -> adminChatId
const adminSessions = new Map();// adminChatId -> customerChatId

function getUserState(chatId) {
  return userStates.get(String(chatId)) || { step: "idle" };
}
function setUserState(chatId, state) {
  userStates.set(String(chatId), state);
}
function clearUserState(chatId) {
  userStates.delete(String(chatId));
}

function formatPrice(price) {
  return (
    new Intl.NumberFormat("uz-UZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(
      Number(price || 0)
    ) + " so'm"
  );
}

async function checkIsAdmin(pool, chatId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM telegram_settings ts
     JOIN users u ON u.id = ts.user_id
     WHERE ts.telegram_chat_id = ? AND u.role IN ('admin', 'bosh_agranom')
     LIMIT 1`,
    [String(chatId)]
  );
  return rows.length > 0;
}

async function getBotConfig(pool) {
  const [rows] = await pool.query("SELECT * FROM telegram_bot_config LIMIT 1");
  return rows[0] || null;
}

async function getProducts(pool) {
  const [rows] = await pool.query(
    `SELECT id, name, description, price, contact_phone, contact_phone_secondary, contact_note, image_path
     FROM customer_products WHERE is_active = 1 ORDER BY display_order ASC, id DESC`
  );
  return rows;
}

async function saveBotOrder(pool, data) {
  const [result] = await pool.query(
    `INSERT INTO bot_orders
      (telegram_user_id, telegram_username, telegram_name, customer_product_id,
       product_name, quantity, address, phone, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    [
      String(data.telegramUserId),
      data.username || null,
      data.fullName || null,
      data.productId || null,
      data.productName,
      data.quantity,
      data.address || null,
      data.phone || null,
      data.notes || null,
    ]
  );
  return result.insertId;
}

function makeCustomerKeyboard(siteUrl) {
  const rows = [
    [{ text: "🌿 Mahsulotlar" }, { text: "📦 Buyurtma berish" }],
    [{ text: "📞 Bog'lanish" }, { text: "ℹ️ Biz haqimizda" }],
  ];
  if (siteUrl) rows.push([{ text: "🌐 Saytda ko'rish" }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, persistent: true } };
}

const ADMIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: "📊 Mini hisobotlar" }, { text: "📋 Buyurtmalar" }],
      [{ text: "🌿 Mahsulotlar" }, { text: "📞 Murojaat" }],
      [{ text: "ℹ️ Biz haqimizda" }],
    ],
    resize_keyboard: true,
    persistent: true,
  },
};

const ADMIN_ORDERS_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: "📋 Sayt buyurtmalari" }, { text: "🤖 Bot buyurtmalari" }],
      [{ text: "🔙 Orqaga" }],
    ],
    resize_keyboard: true,
  },
};

const CANCEL_KEYBOARD = {
  reply_markup: { keyboard: [[{ text: "❌ Bekor qilish" }]], resize_keyboard: true },
};

// Notify all admins about new order (with optional extra options like inline buttons)
async function notifyAdmins(bot, pool, message, extra = {}) {
  try {
    const config = await getBotConfig(pool);
    const sent = new Set();

    if (config?.admin_chat_id) {
      await bot
        .sendMessage(config.admin_chat_id, message, { parse_mode: "HTML", ...extra })
        .catch(() => {});
      sent.add(String(config.admin_chat_id));
    }

    const [admins] = await pool.query(
      `SELECT ts.telegram_chat_id
       FROM telegram_settings ts
       JOIN users u ON u.id = ts.user_id
       WHERE u.role IN ('admin', 'bosh_agranom')
         AND ts.telegram_chat_id IS NOT NULL
         AND ts.is_active = 1
         AND ts.notify_new_order = 1`
    );
    for (const a of admins) {
      if (a.telegram_chat_id && !sent.has(String(a.telegram_chat_id))) {
        await bot
          .sendMessage(a.telegram_chat_id, message, { parse_mode: "HTML", ...extra })
          .catch(() => {});
        sent.add(String(a.telegram_chat_id));
      }
    }
  } catch (err) {
    console.error("[TelegramBot] Admin xabardor qilishda xato:", err.message);
  }
}

// Notify all admins about a pending live chat (no filter on notify_new_order)
async function notifyAdminsChat(bot, pool, message, extra = {}) {
  try {
    const config = await getBotConfig(pool);
    const sent = new Set();

    if (config?.admin_chat_id) {
      await bot
        .sendMessage(config.admin_chat_id, message, { parse_mode: "HTML", ...extra })
        .catch(() => {});
      sent.add(String(config.admin_chat_id));
    }

    const [admins] = await pool.query(
      `SELECT ts.telegram_chat_id
       FROM telegram_settings ts
       JOIN users u ON u.id = ts.user_id
       WHERE u.role IN ('admin', 'bosh_agranom')
         AND ts.telegram_chat_id IS NOT NULL
         AND ts.is_active = 1`
    );
    for (const a of admins) {
      if (a.telegram_chat_id && !sent.has(String(a.telegram_chat_id))) {
        await bot
          .sendMessage(a.telegram_chat_id, message, { parse_mode: "HTML", ...extra })
          .catch(() => {});
        sent.add(String(a.telegram_chat_id));
      }
    }
  } catch (err) {
    console.error("[TelegramBot] Chat xabardor qilishda xato:", err.message);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleStart(bot, msg, pool) {
  const chatId = msg.chat.id;
  clearUserState(chatId);

  const name = msg.from?.first_name || "Foydalanuvchi";
  const admin = await checkIsAdmin(pool, chatId);
  const config = await getBotConfig(pool);

  if (admin) {
    await bot.sendMessage(
      chatId,
      `👋 Salom, <b>${name}</b>!\n\n` +
        `🌿 <b>SAMARQAND QULUPNAY IMPEKS MChJ</b>\n` +
        `Admin boshqaruv paneliga xush kelibsiz.\n\n` +
        `Quyidagi bo'limlardan birini tanlang:`,
      { parse_mode: "HTML", ...ADMIN_KEYBOARD }
    );
  } else {
    await bot.sendMessage(
      chatId,
      `👋 Salom, <b>${name}</b>!\n\n` +
        `🌿 <b>SAMARQAND QULUPNAY IMPEKS MChJ</b>\n\n` +
        `Bu bot orqali siz:\n` +
        `• 🌿 Mahsulotlarimizni ko'rishingiz\n` +
        `• 📦 Buyurtma berishingiz\n` +
        `• 📞 Admin bilan bog'lanishingiz mumkin`,
      { parse_mode: "HTML", ...makeCustomerKeyboard(config?.site_url) }
    );
  }
}

async function handleProducts(bot, msg, pool, admin, config) {
  const chatId = msg.chat.id;
  clearUserState(chatId);
  const keyboard = admin ? ADMIN_KEYBOARD : makeCustomerKeyboard(config?.site_url);

  try {
    const products = await getProducts(pool);
    if (!products.length) {
      return bot.sendMessage(chatId, "Hozircha mahsulotlar mavjud emas.", keyboard);
    }

    await bot.sendMessage(chatId, "🌿 <b>Bizning mahsulotlar:</b>", { parse_mode: "HTML" });

    for (const p of products) {
      let text = `<b>${p.name}</b>\n`;
      if (p.description) text += `📝 ${p.description}\n`;
      text += `💰 Narxi: <b>${formatPrice(p.price)}</b>`;
      if (p.contact_phone) text += `\n📞 ${p.contact_phone}`;
      if (p.contact_phone_secondary) text += `\n📞 ${p.contact_phone_secondary}`;
      if (p.contact_note) text += `\n💬 ${p.contact_note}`;

      let sent = false;
      if (p.image_path) {
        const relativePart = p.image_path.replace(/^\//, "");
        const absolutePath = path.join(BACKEND_ROOT, relativePart);
        if (fs.existsSync(absolutePath)) {
          await bot
            .sendPhoto(chatId, fs.createReadStream(absolutePath), { caption: text, parse_mode: "HTML" })
            .then(() => { sent = true; })
            .catch(() => {});
        }
      }
      if (!sent) {
        await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
      }
    }

    await bot.sendMessage(chatId, "📦 Buyurtma berish uchun pastdagi tugmani bosing:", keyboard);
  } catch (err) {
    console.error("[TelegramBot] Mahsulotlar xatosi:", err.message);
    await bot.sendMessage(chatId, "Xato yuz berdi.", keyboard);
  }
}

async function handleMiniReport(bot, chatId, pool) {
  try {
    const q = async (sql, params = []) => {
      const [[row]] = await pool.query(sql, params).catch(() => [[{}]]);
      return row;
    };

    const { stages = 0 } = await q("SELECT COUNT(DISTINCT stage) AS stages FROM greenhouse_stage_stock WHERE quantity > 0");
    const { batches = 0 } = await q("SELECT COUNT(*) AS batches FROM seedling_batches");
    const { readyQty = 0 } = await q(
      "SELECT COALESCE(SUM(quantity_available),0) AS readyQty FROM seedling_inventory"
    );
    const { locations = 0 } = await q("SELECT COUNT(*) AS locations FROM locations");
    const { transfers = 0 } = await q(
      "SELECT COUNT(*) AS transfers FROM transfers WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
    );
    const { activeOrders = 0 } = await q(
      "SELECT COUNT(*) AS activeOrders FROM orders WHERE status IN ('new','confirmed','processing')"
    );
    const { newBotOrders = 0 } = await q(
      "SELECT COUNT(*) AS newBotOrders FROM bot_orders WHERE status = 'new'"
    );

    const text =
      `📊 <b>Mini hisobot</b>\n\n` +
      `🏭 Teplitsa bosqichlari: <b>${stages}</b>\n` +
      `🌱 Faol partiyalar: <b>${batches}</b>\n` +
      `📦 Tayyor ko'chatlar: <b>${Number(readyQty).toLocaleString("uz-UZ")} ta</b>\n` +
      `📍 Lokatsiyalar: <b>${locations}</b>\n` +
      `🔄 Transferlar (7 kun): <b>${transfers}</b>\n` +
      `📋 Faol sayt buyurtmalari: <b>${activeOrders}</b>\n` +
      `🤖 Yangi bot buyurtmalari: <b>${newBotOrders}</b>`;

    await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...ADMIN_KEYBOARD });
  } catch (err) {
    console.error("[TelegramBot] Mini hisobot xatosi:", err.message);
    await bot.sendMessage(chatId, "Hisobot olishda xato.", ADMIN_KEYBOARD);
  }
}

async function handleSiteOrders(bot, chatId, pool) {
  try {
    const [orders] = await pool.query(
      `SELECT o.id, o.status, o.created_at, o.customer_name, o.customer_phone,
              o.total_quantity, o.total_amount
       FROM orders o
       WHERE o.status IN ('new','confirmed','processing')
       ORDER BY o.created_at DESC LIMIT 10`
    );

    if (!orders.length) {
      return bot.sendMessage(chatId, "Faol sayt buyurtmalari yo'q.", ADMIN_ORDERS_KEYBOARD);
    }

    let text = "📋 <b>Sayt buyurtmalari (so'nggi 10):</b>\n\n";
    for (const o of orders) {
      const date = new Date(o.created_at).toLocaleDateString("uz-UZ");
      text += `#${o.id} — ${o.customer_name || "Noma'lum"} · ${date}\n`;
      text += `   🔢 ${o.total_quantity || 0} ta · 💰 ${formatPrice(o.total_amount)}\n`;
      text += `   📞 ${o.customer_phone || "—"} · <i>${o.status}</i>\n\n`;
    }

    await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...ADMIN_ORDERS_KEYBOARD });
  } catch (err) {
    console.error("[TelegramBot] Sayt buyurtmalari xatosi:", err.message);
    await bot.sendMessage(chatId, "Xato yuz berdi.", ADMIN_ORDERS_KEYBOARD);
  }
}

async function handleBotOrders(bot, chatId, pool) {
  try {
    const [orders] = await pool.query(
      "SELECT * FROM bot_orders ORDER BY created_at DESC LIMIT 15"
    );

    if (!orders.length) {
      return bot.sendMessage(chatId, "Bot buyurtmalari yo'q.", ADMIN_ORDERS_KEYBOARD);
    }

    const newCount = orders.filter(o => o.status === "new").length;
    await bot.sendMessage(chatId, `🤖 <b>Bot buyurtmalari (jami: ${orders.length}, yangi: ${newCount}):</b>`, {
      parse_mode: "HTML",
    });

    for (const o of orders) {
      const date = new Date(o.created_at).toLocaleDateString("uz-UZ");

      const [[{ ready = 0 } = {}] = [{}]] = await pool
        .query(
          "SELECT COALESCE(SUM(quantity_available),0) AS ready FROM seedling_inventory"
        )
        .catch(() => [[{ ready: 0 }]]);

      const statusMap = { new: "🟡 Yangi", confirmed: "✅ Tasdiqlangan", cancelled: "❌ Bekor", completed: "✔️ Bajarildi" };
      const text =
        `🤖 <b>Bot buyurtma #${o.id}</b> — ${statusMap[o.status] || o.status}\n\n` +
        `👤 ${o.telegram_name || "—"}${o.telegram_username ? ` (@${o.telegram_username})` : ""}\n` +
        `🌿 Mahsulot: <b>${o.product_name}</b>\n` +
        `🔢 Miqdor: <b>${o.quantity} ta</b>\n` +
        `📦 Omborda jami: <b>${Number(ready).toLocaleString("uz-UZ")} ta</b>\n` +
        (o.address ? `📍 ${o.address}\n` : "") +
        (o.phone ? `📞 ${o.phone}\n` : "") +
        `📅 ${date}`;

      const inlineKeyboard = o.status === "new"
        ? { inline_keyboard: [[{ text: "✅ Tasdiqlash", callback_data: `co_${o.id}` }, { text: "❌ Rad etish", callback_data: `ro_${o.id}` }]] }
        : { inline_keyboard: [] };

      await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: inlineKeyboard });
    }
  } catch (err) {
    console.error("[TelegramBot] Bot buyurtmalari xatosi:", err.message);
    await bot.sendMessage(chatId, "Xato yuz berdi.", ADMIN_ORDERS_KEYBOARD);
  }
}

async function handleLiveChatRequest(bot, msg, pool, config) {
  const chatId = msg.chat.id;
  clearUserState(chatId);
  setUserState(chatId, { step: "live_chat_waiting" });

  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Mijoz";
  if (!pendingChats.has(String(chatId))) {
    pendingChats.set(String(chatId), { name, msgs: [] });
  }

  await bot.sendMessage(
    chatId,
    "💬 Murojaat qoldirdingiz. Admin javob berishi kutilmoqda...\n\n" +
      "Xabarlaringizni yozing — admin qabul qilganda ulanadi.\n" +
      "Chatdan chiqish: /end",
    { reply_markup: { keyboard: [[{ text: "/end" }]], resize_keyboard: true } }
  );

  const notifyText =
    `💬 <b>Yangi murojaat</b>\n` +
    `👤 ${name}${msg.from?.username ? ` (@${msg.from.username})` : ""}`;

  await notifyAdminsChat(bot, pool, notifyText, {
    reply_markup: {
      inline_keyboard: [[
        { text: "💬 Chatni qabul qilish", callback_data: `accept_chat_${chatId}` },
      ]],
    },
  });
}

async function handleCallbackQuery(bot, query, pool) {
  const data = query.data;
  const adminChatId = String(query.message.chat.id);

  if (data.startsWith("co_")) {
    const orderId = data.slice(3);
    try {
      await pool.query("UPDATE bot_orders SET status = 'confirmed' WHERE id = ?", [orderId]);
      await bot.answerCallbackQuery(query.id, { text: "✅ Buyurtma tasdiqlandi" });
      await bot
        .editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        )
        .catch(() => {});
      await bot.sendMessage(adminChatId, `✅ Buyurtma #${orderId} tasdiqlandi.`, ADMIN_KEYBOARD);

      const [[order] = [null]] = await pool
        .query("SELECT * FROM bot_orders WHERE id = ?", [orderId])
        .catch(() => [[null]]);
      if (order?.telegram_user_id) {
        await bot
          .sendMessage(
            order.telegram_user_id,
            `✅ <b>Buyurtmangiz tasdiqlandi!</b>\n\nBuyurtma #${orderId}\nAdmin siz bilan tez orada bog'lanadi.`,
            { parse_mode: "HTML" }
          )
          .catch(() => {});
      }
    } catch (err) {
      await bot.answerCallbackQuery(query.id, { text: "Xato yuz berdi" }).catch(() => {});
    }
    return;
  }

  if (data.startsWith("ro_")) {
    const orderId = data.slice(3);
    try {
      await pool.query("UPDATE bot_orders SET status = 'cancelled' WHERE id = ?", [orderId]);
      await bot.answerCallbackQuery(query.id, { text: "❌ Buyurtma rad etildi" });
      await bot
        .editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        )
        .catch(() => {});
      await bot.sendMessage(adminChatId, `❌ Buyurtma #${orderId} rad etildi.`, ADMIN_KEYBOARD);

      const [[order] = [null]] = await pool
        .query("SELECT * FROM bot_orders WHERE id = ?", [orderId])
        .catch(() => [[null]]);
      if (order?.telegram_user_id) {
        await bot
          .sendMessage(
            order.telegram_user_id,
            `❌ <b>Buyurtmangiz rad etildi.</b>\n\nBuyurtma #${orderId}\nBatafsil ma'lumot uchun admin bilan bog'laning.`,
            { parse_mode: "HTML" }
          )
          .catch(() => {});
      }
    } catch (err) {
      await bot.answerCallbackQuery(query.id, { text: "Xato yuz berdi" }).catch(() => {});
    }
    return;
  }

  if (data.startsWith("accept_chat_")) {
    const customerChatId = data.slice("accept_chat_".length);

    chatSessions.set(customerChatId, adminChatId);
    adminSessions.set(adminChatId, customerChatId);

    await bot.answerCallbackQuery(query.id, { text: "💬 Chat qabul qilindi" }).catch(() => {});

    const pending = pendingChats.get(customerChatId) || { name: "Mijoz", msgs: [] };
    let introText =
      `💬 <b>Chat boshlandi</b> — ${pending.name}\n\n` +
      `Yakunlash uchun: <b>yakunlash</b>`;
    if (pending.msgs.length) {
      introText += "\n\n<b>Buferidagi xabarlar:</b>";
      for (const m of pending.msgs) introText += `\n👤 ${m}`;
    }

    await bot.sendMessage(adminChatId, introText, {
      parse_mode: "HTML",
      reply_markup: { keyboard: [[{ text: "yakunlash" }]], resize_keyboard: true },
    });
    setUserState(adminChatId, { step: "live_chat_admin", customerChatId });

    await bot
      .sendMessage(
        customerChatId,
        "✅ Admin sizning murojatingizni qabul qildi. Endi yozishingiz mumkin:\n/end — chatdan chiqish",
        { reply_markup: { keyboard: [[{ text: "/end" }]], resize_keyboard: true } }
      )
      .catch(() => {});
    setUserState(customerChatId, { step: "live_chat_active" });
    pendingChats.delete(customerChatId);
    return;
  }

  await bot.answerCallbackQuery(query.id).catch(() => {});
}

// ─── Main message handler ─────────────────────────────────────────────────────

async function handleMessage(bot, msg, pool) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const state = getUserState(chatId);

  // Admin live chat — forward to customer or end
  if (state.step === "live_chat_admin") {
    if (text === "yakunlash") {
      const customerChatId = state.customerChatId;
      chatSessions.delete(customerChatId);
      adminSessions.delete(String(chatId));
      clearUserState(chatId);
      clearUserState(customerChatId);
      await bot.sendMessage(chatId, "✅ Chat yakunlandi.", ADMIN_KEYBOARD);
      const config = await getBotConfig(pool);
      await bot
        .sendMessage(customerChatId, "💬 Chat yakunlandi. Yana murojaat qilish uchun menuni ishlating.", makeCustomerKeyboard(config?.site_url))
        .catch(() => {});
      return;
    }
    if (state.customerChatId) {
      await bot.sendMessage(state.customerChatId, `💬 Admin: ${text}`).catch(() => {});
    }
    return;
  }

  // Customer live chat — forward to admin or end
  if (state.step === "live_chat_active") {
    if (text === "/end") {
      const linkedAdmin = chatSessions.get(String(chatId));
      if (linkedAdmin) {
        chatSessions.delete(String(chatId));
        adminSessions.delete(linkedAdmin);
        clearUserState(linkedAdmin);
        await bot.sendMessage(linkedAdmin, "💬 Mijoz chatdan chiqdi.", ADMIN_KEYBOARD).catch(() => {});
      }
      clearUserState(chatId);
      const config = await getBotConfig(pool);
      await bot.sendMessage(chatId, "Chat yakunlandi.", makeCustomerKeyboard(config?.site_url));
      return;
    }
    const linkedAdmin = chatSessions.get(String(chatId));
    if (linkedAdmin) {
      const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Mijoz";
      await bot.sendMessage(linkedAdmin, `👤 ${name}: ${text}`).catch(() => {});
    }
    return;
  }

  // Customer waiting — buffer messages
  if (state.step === "live_chat_waiting") {
    if (text === "/end") {
      pendingChats.delete(String(chatId));
      clearUserState(chatId);
      const config = await getBotConfig(pool);
      await bot.sendMessage(chatId, "Murojaat bekor qilindi.", makeCustomerKeyboard(config?.site_url));
      return;
    }
    const pending = pendingChats.get(String(chatId)) || { name: "", msgs: [] };
    pending.msgs.push(text);
    pendingChats.set(String(chatId), pending);
    await bot.sendMessage(chatId, "⏳ Xabaringiz saqlandi. Admin javob berishi kutilmoqda...");
    return;
  }

  // /start
  if (text === "/start" || text === "🏠 Asosiy menyu") {
    return handleStart(bot, msg, pool);
  }

  // Determine role + config (used by all branches below)
  const [admin, config] = await Promise.all([checkIsAdmin(pool, chatId), getBotConfig(pool)]);
  const customerKeyboard = makeCustomerKeyboard(config?.site_url);

  // ── ADMIN COMMANDS ─────────────────────────────────────────────────────────
  if (admin) {
    if (text === "📊 Mini hisobotlar") return handleMiniReport(bot, chatId, pool);

    if (text === "📋 Buyurtmalar") {
      return bot.sendMessage(chatId, "📋 <b>Buyurtmalar</b>\nQaysi buyurtmalarni ko'rmoqchisiz?", {
        parse_mode: "HTML",
        ...ADMIN_ORDERS_KEYBOARD,
      });
    }

    if (text === "📋 Sayt buyurtmalari") return handleSiteOrders(bot, chatId, pool);
    if (text === "🤖 Bot buyurtmalari") return handleBotOrders(bot, chatId, pool);

    if (text === "🔙 Orqaga") {
      return bot.sendMessage(chatId, "Asosiy menyu:", ADMIN_KEYBOARD);
    }

    if (text === "🌿 Mahsulotlar") return handleProducts(bot, msg, pool, true, config);

    if (text === "📞 Murojaat") {
      if (pendingChats.size === 0) {
        return bot.sendMessage(chatId, "Hozircha kutilayotgan murojaatlar yo'q.", ADMIN_KEYBOARD);
      }
      let murojaatText = "💬 <b>Kutilayotgan murojaatlar:</b>\n\n";
      for (const [cid, data] of pendingChats) {
        murojaatText += `👤 ${data.name} (${cid}) — ${data.msgs.length} xabar\n`;
      }
      return bot.sendMessage(chatId, murojaatText, { parse_mode: "HTML", ...ADMIN_KEYBOARD });
    }

    if (text === "ℹ️ Biz haqimizda") {
      return bot.sendMessage(
        chatId,
        `🌿 <b>SAMARQAND QULUPNAY IMPEKS MChJ</b>\n\nYuqori sifatli ko'chat yetishtirish va sotish.\n📞 +998 93 003 05 30`,
        { parse_mode: "HTML", ...ADMIN_KEYBOARD }
      );
    }

    return bot.sendMessage(chatId, "Pastdagi tugmalardan birini tanlang:", ADMIN_KEYBOARD);
  }

  // ── CUSTOMER COMMANDS ──────────────────────────────────────────────────────
  if (text === "🌿 Mahsulotlar") return handleProducts(bot, msg, pool, false, config);

  if (text === "📦 Buyurtma berish") {
    try {
      const products = await getProducts(pool);
      if (!products.length) {
        return bot.sendMessage(chatId, "Hozircha mahsulotlar mavjud emas.", customerKeyboard);
      }
      const kb = products.map((p) => [{ text: `${p.name} — ${formatPrice(p.price)}` }]);
      kb.push([{ text: "❌ Bekor qilish" }]);
      setUserState(chatId, { step: "choose_product", products });
      return bot.sendMessage(chatId, "📦 Qaysi mahsulotni buyurtma qilmoqchisiz?", {
        reply_markup: { keyboard: kb, resize_keyboard: true },
      });
    } catch (err) {
      return bot.sendMessage(chatId, "Xato yuz berdi.", customerKeyboard);
    }
  }

  if (text === "📞 Bog'lanish") return handleLiveChatRequest(bot, msg, pool, config);

  if (text === "🌐 Saytda ko'rish") {
    if (config?.site_url) {
      return bot.sendMessage(
        chatId,
        `🌐 Saytimizga tashrif buyuring:\n${config.site_url}`,
        customerKeyboard
      );
    }
    return bot.sendMessage(chatId, "Sayt manzili hali sozlanmagan.", customerKeyboard);
  }

  if (text === "ℹ️ Biz haqimizda") {
    clearUserState(chatId);
    return bot.sendMessage(
      chatId,
      `🌿 <b>SAMARQAND QULUPNAY IMPEKS MChJ</b>\n\nYuqori sifatli ko'chat yetishtirish va sotish platformasi.\n📞 +998 93 003 05 30\n\nBuyurtma yoki ma'lumot uchun biz bilan bog'laning.`,
      { parse_mode: "HTML", ...customerKeyboard }
    );
  }

  if (text === "❌ Bekor qilish") {
    clearUserState(chatId);
    return bot.sendMessage(chatId, "Amal bekor qilindi.", customerKeyboard);
  }

  // ── ORDER FLOW ─────────────────────────────────────────────────────────────
  if (state.step === "choose_product") {
    const products = state.products || [];
    const chosen = products.find((p) => text.startsWith(p.name));
    if (!chosen) {
      return bot.sendMessage(chatId, "Iltimos, ro'yxatdan mahsulot tanlang.", {
        reply_markup: {
          keyboard: [...products.map((p) => [{ text: `${p.name} — ${formatPrice(p.price)}` }]), [{ text: "❌ Bekor qilish" }]],
          resize_keyboard: true,
        },
      });
    }
    setUserState(chatId, { step: "enter_quantity", product: chosen });
    return bot.sendMessage(
      chatId,
      `✅ Tanladingiz: <b>${chosen.name}</b>\n💰 Narxi: ${formatPrice(chosen.price)}\n\nNechtasini buyurtma qilmoqchisiz?`,
      { parse_mode: "HTML", ...CANCEL_KEYBOARD }
    );
  }

  if (state.step === "enter_quantity") {
    const qty = parseInt(text, 10);
    if (isNaN(qty) || qty < 1) {
      return bot.sendMessage(chatId, "Iltimos, to'g'ri miqdor kiriting (masalan: 100).", CANCEL_KEYBOARD);
    }
    setUserState(chatId, { ...state, step: "enter_address", quantity: qty });
    return bot.sendMessage(chatId, "📍 Yetkazib berish manzilingizni yuboring:", CANCEL_KEYBOARD);
  }

  if (state.step === "enter_address") {
    setUserState(chatId, { ...state, step: "enter_phone", address: text });
    return bot.sendMessage(chatId, "📞 Telefon raqamingizni kiriting (+998...):", CANCEL_KEYBOARD);
  }

  if (state.step === "enter_phone") {
    setUserState(chatId, { ...state, step: "confirm", phone: text });
    return bot.sendMessage(
      chatId,
      `📋 <b>Buyurtma ma'lumotlari:</b>\n\n` +
        `🌿 Mahsulot: <b>${state.product?.name}</b>\n` +
        `🔢 Miqdor: <b>${state.quantity} ta</b>\n` +
        `💰 Narxi: <b>${formatPrice(state.product?.price)}</b>\n` +
        `📍 Manzil: <b>${state.address}</b>\n` +
        `📞 Telefon: <b>${text}</b>\n\n` +
        `Tasdiqlaysizmi?`,
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "✅ Tasdiqlash" }, { text: "❌ Bekor qilish" }]],
          resize_keyboard: true,
        },
      }
    );
  }

  if (state.step === "confirm") {
    if (text === "✅ Tasdiqlash") {
      try {
        const orderId = await saveBotOrder(pool, {
          telegramUserId: msg.from.id,
          username: msg.from.username,
          fullName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
          productId: state.product?.id,
          productName: state.product?.name,
          quantity: state.quantity,
          address: state.address,
          phone: state.phone,
        });
        clearUserState(chatId);

        await bot.sendMessage(
          chatId,
          `✅ <b>Buyurtmangiz qabul qilindi!</b>\n\nBuyurtma raqami: <b>#${orderId}</b>\nAdmin siz bilan tez orada bog'lanadi. 🌿`,
          { parse_mode: "HTML", ...customerKeyboard }
        );

        // Total ready seedlings for admin awareness
        const [[{ ready = 0 } = {}] = [{}]] = await pool
          .query("SELECT COALESCE(SUM(quantity_available),0) AS ready FROM seedling_inventory")
          .catch(() => [[{ ready: 0 }]]);

        const adminMsg =
          `🔔 <b>Yangi buyurtma (Bot) #${orderId}</b>\n\n` +
          `👤 ${[msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ")}` +
          (msg.from.username ? ` (@${msg.from.username})` : "") + "\n" +
          `🌿 Mahsulot: ${state.product?.name}\n` +
          `🔢 Miqdor: ${state.quantity} ta\n` +
          `📦 Tayyor (omborda): ${Number(ready).toLocaleString("uz-UZ")} ta\n` +
          (state.address ? `📍 ${state.address}\n` : "") +
          (state.phone ? `📞 ${state.phone}\n` : "");

        await notifyAdmins(bot, pool, adminMsg, {
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Tasdiqlash", callback_data: `co_${orderId}` },
              { text: "❌ Rad etish", callback_data: `ro_${orderId}` },
            ]],
          },
        });
      } catch (err) {
        console.error("[TelegramBot] Buyurtma saqlashda xato:", err.message);
        await bot.sendMessage(chatId, "❌ Xato yuz berdi. Iltimos qaytadan urinib ko'ring.", customerKeyboard);
      }
    } else {
      clearUserState(chatId);
      await bot.sendMessage(chatId, "Buyurtma bekor qilindi.", customerKeyboard);
    }
    return;
  }

  // Default
  await bot.sendMessage(chatId, "Pastdagi tugmalardan birini tanlang:", customerKeyboard);
}

// ─── Bot lifecycle ────────────────────────────────────────────────────────────

export async function startTelegramBot() {
  try {
    const pool = getPool();
    const config = await getBotConfig(pool);

    if (!config?.bot_token || !config.is_active) {
      console.log("[TelegramBot] Bot token mavjud emas yoki faol emas — bot ishlamaydi.");
      return;
    }

    if (botInstance) {
      try { await botInstance.stopPolling(); } catch (_) {}
      botInstance = null;
    }

    const bot = new TelegramBot(config.bot_token, { polling: true });
    botInstance = bot;

    bot.on("message", async (msg) => {
      try {
        await handleMessage(bot, msg, getPool());
      } catch (err) {
        console.error("[TelegramBot] Xabar qayta ishlashda xato:", err.message);
        try { await bot.sendMessage(msg.chat.id, "❌ Xato yuz berdi. Keyinroq urinib ko'ring."); } catch (_) {}
      }
    });

    bot.on("callback_query", async (query) => {
      try {
        await handleCallbackQuery(bot, query, getPool());
      } catch (err) {
        console.error("[TelegramBot] Callback xatosi:", err.message);
        try { await bot.answerCallbackQuery(query.id, { text: "Xato yuz berdi" }); } catch (_) {}
      }
    });

    bot.on("polling_error", (err) => {
      console.error("[TelegramBot] Polling xatosi:", err.message || err);
    });

    console.log("[TelegramBot] Bot muvaffaqiyatli ishga tushdi.");
    return bot;
  } catch (err) {
    console.error("[TelegramBot] Bot ishga tushirishda xato:", err.message);
  }
}

export async function stopTelegramBot() {
  if (botInstance) {
    try {
      await botInstance.stopPolling();
      botInstance = null;
      console.log("[TelegramBot] Bot to'xtatildi.");
    } catch (err) {
      console.error("[TelegramBot] Botni to'xtatishda xato:", err.message);
    }
  }
}

export function getBotInstance() {
  return botInstance;
}
