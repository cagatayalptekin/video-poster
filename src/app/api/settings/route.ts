import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/settings";

export async function GET() {
  const settings = await getAllSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const allowedKeys = [
      "posting_interval_hours",
      "auto_delete_after_success",
      "max_retry_count",
      "app_timezone",
      "default_caption_suffix",
    ];

    for (const [key, value] of Object.entries(body)) {
      if (allowedKeys.includes(key)) {
        await setSetting(key, String(value));
      }
    }

    const settings = await getAllSettings();
    return NextResponse.json(settings);
  } catch {
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
