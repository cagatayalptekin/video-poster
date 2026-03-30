import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await prisma.socialAccount.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(accounts);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform, accountName, username, isActive, authType, accessToken, refreshToken, metadata } = body;

    if (!platform || !accountName || !username) {
      return NextResponse.json({ error: "platform, accountName, and username are required" }, { status: 400 });
    }

    const validPlatforms = ["tiktok", "instagram", "youtube"];
    if (!validPlatforms.includes(platform)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }

    const account = await prisma.socialAccount.create({
      data: {
        platform,
        accountName,
        username,
        isActive: isActive ?? true,
        authType: authType || "manual",
        accessToken: accessToken || null,
        refreshToken: refreshToken || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    console.error("Create account error:", err);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
