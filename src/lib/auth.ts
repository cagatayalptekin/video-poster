import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import prisma from "./prisma";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-change-me";
const TOKEN_COOKIE = "admin_token";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: { userId: string; username: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyToken(token: string): { userId: string; username: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<{ userId: string; username: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function ensureAdminExists(): Promise<void> {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const existing = await prisma.adminUser.findUnique({ where: { username } });
  if (!existing) {
    const hashed = await hashPassword(password);
    await prisma.adminUser.create({ data: { username, password: hashed } });
  }
}
