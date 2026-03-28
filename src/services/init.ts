import { startScheduler } from "../lib/scheduler";
import { ensureAdminExists } from "../lib/auth";
import { log } from "../lib/logger";

let initialized = false;

export async function initializeApp() {
  if (initialized) return;
  initialized = true;

  try {
    await ensureAdminExists();
    await startScheduler();
    await log({ level: "info", context: "system", message: "Application initialized" });
  } catch (err) {
    console.error("Failed to initialize app:", err);
  }
}
