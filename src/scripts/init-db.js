import { ensureDatabaseReady } from "../db/bootstrap.js";

ensureDatabaseReady()
  .then(() => {
    console.log("Database tayyor bo'ldi.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Database init xatoligi:", error);
    process.exit(1);
  });
