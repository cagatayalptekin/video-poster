import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSchedulerStatus } from "@/lib/scheduler";
import { initializeApp } from "@/services/init";

export async function GET() {
  await initializeApp();

  const [queued, completed, failed, activeAccounts, recentLogs] = await Promise.all([
    prisma.videoQueueItem.count({ where: { status: "queued" } }),
    prisma.videoQueueItem.count({ where: { status: "completed" } }),
    prisma.videoQueueItem.count({ where: { status: { in: ["failed", "partially_posted"] } } }),
    prisma.socialAccount.count({ where: { isActive: true } }),
    prisma.jobLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const scheduler = getSchedulerStatus();

  return NextResponse.json({
    queued,
    completed,
    failed,
    activeAccounts,
    scheduler,
    recentLogs,
  });
}
