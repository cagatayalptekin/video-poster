import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await prisma.socialAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(account);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { platform, accountName, username, isActive, authType, accessToken, refreshToken, metadata } = body;

    const account = await prisma.socialAccount.update({
      where: { id },
      data: {
        ...(platform && { platform }),
        ...(accountName && { accountName }),
        ...(username && { username }),
        ...(isActive !== undefined && { isActive }),
        ...(authType && { authType }),
        ...(accessToken !== undefined && { accessToken: accessToken || null }),
        ...(refreshToken !== undefined && { refreshToken: refreshToken || null }),
        ...(metadata !== undefined && { metadata: metadata ? JSON.stringify(metadata) : null }),
      },
    });

    return NextResponse.json(account);
  } catch (err) {
    console.error("Update account error:", err);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.socialAccount.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
