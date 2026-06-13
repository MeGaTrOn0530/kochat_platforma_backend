import app from "./app.js";
import env from "./config/env.js";
import { ensureDatabaseReady } from "./db/bootstrap.js";
import { closePool, initPool } from "./config/database.js";
import { startTelegramBot, stopTelegramBot } from "./services/telegram-bot.js";

async function start() {
  if (env.autoInitDb) {
    await ensureDatabaseReady();
  }

  initPool();

  // Telegram botni ishga tushirish (token bo'lsa)
  setTimeout(() => {
    startTelegramBot().catch(err => {
      console.error("[TelegramBot] Ishga tushirishda xato:", err.message);
    });
  }, 2000);

  const host = process.env.HOST || "0.0.0.0";
  const server = app.listen(env.port, host, () => {
    console.log(`Server ${host}:${env.port} da ishga tushdi`);
    if (host === "0.0.0.0") {
      console.log(`WiFi orqali: http://<local_IP>:${env.port}`);
      console.log(`QR skan test: http://<local_IP>:${env.port}/scan/BATCH-XXXX`);
    }
  });

  const shutdown = async () => {
    await stopTelegramBot();
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Server start xatoligi:", error);
  process.exit(1);
});
