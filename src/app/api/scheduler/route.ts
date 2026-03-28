import { NextResponse } from "next/server";
import { runNow, getSchedulerStatus } from "@/lib/scheduler";

export async function POST() {
  try {
    await runNow();
    return NextResponse.json({ success: true, message: "Queue processing triggered" });
  } catch (err) {
    return NextResponse.json(
      { error: `Scheduler error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

export async function GET() {
  const status = getSchedulerStatus();
  return NextResponse.json(status);
}
