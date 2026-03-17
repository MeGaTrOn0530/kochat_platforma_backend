import app from "./app.js";
import env from "./config/env.js";
import { ensureDatabaseReady } from "./db/bootstrap.js";
import { closePool, initPool } from "./config/database.js";

async function start() {
  if (env.autoInitDb) {
    await ensureDatabaseReady();
  }

  initPool();

  const server = app.listen(env.port, () => {
    console.log(`Server ${env.port}-portda ishga tushdi`);
  });

  const shutdown = async () => {
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
