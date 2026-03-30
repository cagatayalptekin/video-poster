import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const level = searchParams.get("level");
  const platform = searchParams.get("platform");
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);
  const offset = Number(searchParams.get("offset")) || 0;

  const where: Record<string, unknown> = {};
  if (level) where.level = level;
  if (platform) where.platform = platform;

  const [logs, total] = await Promise.all([
    prisma.jobLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        socialAccount: { select: { accountName: true, platform: true } },
        videoQueueItem: { select: { originalFilename: true } },
      },
    }),
    prisma.jobLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, limit, offset });
}
