import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.videoQueueItem.findUnique({
    where: { id },
    include: { targets: { include: { socialAccount: true } } },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const item = await prisma.videoQueueItem.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Delete file from disk
    try {
      const fullPath = path.resolve(item.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {
      // Ignore file deletion errors
    }

    await prisma.videoQueueItem.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

// Retry a failed video
export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const item = await prisma.videoQueueItem.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (item.status !== "failed" && item.status !== "partially_posted") {
      return NextResponse.json({ error: "Can only retry failed or partially posted items" }, { status: 400 });
    }

    // Reset failed targets to pending
    await prisma.videoPlatformTarget.updateMany({
      where: { videoQueueItemId: id, status: "failed" },
      data: { status: "pending", errorMessage: null },
    });

    // Re-queue the item
    await prisma.videoQueueItem.update({
      where: { id },
      data: { status: "queued", errorMessage: null },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to retry" }, { status: 500 });
  }
}
