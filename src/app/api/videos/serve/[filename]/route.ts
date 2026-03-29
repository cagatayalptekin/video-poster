import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

/**
 * GET /api/videos/serve/[filename] — Serve an uploaded video file.
 *
 * Used by Instagram Graph API which requires a publicly accessible video URL.
 * Only serves files from the uploads directory (no path traversal).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Sanitize: only allow alphanumeric, hyphens, underscores, dots
  if (!/^[\w\-.]+$/.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(path.resolve(UPLOAD_DIR), filename);

  // Prevent path traversal
  const resolvedUpload = path.resolve(UPLOAD_DIR);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedUpload)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType =
    ext === ".mp4" ? "video/mp4" :
    ext === ".mov" ? "video/quicktime" :
    ext === ".webm" ? "video/webm" :
    ext === ".avi" ? "video/x-msvideo" :
    "application/octet-stream";

  const fileStream = fs.createReadStream(filePath);
  const readableStream = new ReadableStream({
    start(controller) {
      fileStream.on("data", (chunk) => controller.enqueue(chunk));
      fileStream.on("end", () => controller.close());
      fileStream.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(readableStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
