import cron, { ScheduledTask } from "node-cron";
import { processNextInQueue } from "../services/queue-processor";
import { log } from "./logger";
import { getSetting } from "./settings";

let schedulerTask: ScheduledTask | null = null;
let lastRun: Date | null = null;
let nextRun: Date | null = null;

export function getSchedulerStatus() {
  return {
    running: schedulerTask !== null,
    lastRun,
    nextRun,
  };
}

export async function startScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
  }

  const intervalHours = Number(await getSetting("posting_interval_hours")) || 24;

  // Run every N hours. For cron, we run at the top of every Nth hour.
  // For simplicity, if interval is 24, run at midnight every day.
  // If interval is 1, run every hour, etc.
  let cronExpression: string;
  if (intervalHours >= 24) {
    cronExpression = "0 0 * * *"; // Daily at midnight
  } else if (intervalHours >= 1) {
    cronExpression = `0 */${intervalHours} * * *`; // Every N hours
  } else {
    cronExpression = "*/5 * * * *"; // Every 5 minutes for testing
  }

  schedulerTask = cron.schedule(cronExpression, async () => {
    lastRun = new Date();
    await log({ level: "info", context: "scheduler", message: "Scheduler triggered - processing queue" });
    await processNextInQueue();
    // Calculate next run
    nextRun = new Date(Date.now() + intervalHours * 60 * 60 * 1000);
  });

  nextRun = new Date(Date.now() + intervalHours * 60 * 60 * 1000);

  await log({
    level: "info",
    context: "scheduler",
    message: `Scheduler started with cron: ${cronExpression} (every ${intervalHours}h)`,
  });
}

export async function runNow() {
  lastRun = new Date();
  await log({ level: "info", context: "scheduler", message: "Manual run triggered" });
  await processNextInQueue();
}
