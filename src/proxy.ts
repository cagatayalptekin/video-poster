import { NextRequest, NextResponse } from "next/server";

// Edge-compatible JWT verification (no Node.js crypto dependency)
async function verifyJWT(token: string): Promise<{ userId: string; username: string } | null> {
  try {
    const secret = process.env.JWT_SECRET || "fallback-secret-change-me";
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // Check auth for all dashboard and API routes
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api/")) {
    const token = request.cookies.get("admin_token")?.value;
    if (!token) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const payload = await verifyJWT(token);
    if (!payload) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.delete("admin_token");
      return response;
    }
  }

  // Redirect root to dashboard
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
