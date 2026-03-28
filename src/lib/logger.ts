import prisma from "./prisma";

type LogLevel = "info" | "warn" | "error" | "success";

interface LogParams {
  level?: LogLevel;
  context?: string;
  message: string;
  details?: Record<string, unknown>;
  platform?: string;
  socialAccountId?: string;
  videoQueueItemId?: string;
}

export async function log(params: LogParams) {
  const { level = "info", context, message, details, platform, socialAccountId, videoQueueItemId } = params;
  console.log(`[${level.toUpperCase()}] ${context ? `[${context}] ` : ""}${message}`);
  try {
    await prisma.jobLog.create({
      data: {
        level,
        context,
        message,
        details: details ? JSON.stringify(details) : null,
        platform,
        socialAccountId,
        videoQueueItemId,
      },
    });
  } catch (err) {
    console.error("Failed to write log to DB:", err);
  }
}
