import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_FILE_SIZE = (Number(process.env.MAX_FILE_SIZE_MB) || 500) * 1024 * 1024;

const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");

  const where = status ? { status } : {};
  const items = await prisma.videoQueueItem.findMany({
    where,
    include: { targets: { include: { socialAccount: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const caption = formData.get("caption") as string | null;
    const hashtags = formData.get("hashtags") as string | null;
    const platformsJson = formData.get("platforms") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Validate file extension
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max size: ${process.env.MAX_FILE_SIZE_MB || 500}MB` },
        { status: 400 }
      );
    }

    // Parse platform targets: [{ platform: "youtube", accountIds: ["id1", "id2"] }]
    let platforms: { platform: string; accountIds: string[] }[] = [];
    if (platformsJson) {
      platforms = JSON.parse(platformsJson);
    }

    if (platforms.length === 0) {
      return NextResponse.json({ error: "At least one platform target is required" }, { status: 400 });
    }

    // Save file
    const storedFilename = `${uuidv4()}${ext}`;
    const uploadDir = path.resolve(UPLOAD_DIR);
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, storedFilename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Create queue item with targets
    const item = await prisma.videoQueueItem.create({
      data: {
        originalFilename: file.name,
        storedFilename,
        filePath,
        caption: caption || null,
        hashtags: hashtags || null,
        status: "queued",
        targets: {
          create: platforms.flatMap((p) =>
            p.accountIds.map((accountId) => ({
              platform: p.platform,
              socialAccountId: accountId,
            }))
          ),
        },
      },
      include: { targets: { include: { socialAccount: true } } },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Failed to upload video" }, { status: 500 });
  }
}
