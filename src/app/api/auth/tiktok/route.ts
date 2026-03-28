import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

/**
 * GET /api/auth/tiktok — Redirect the admin to TikTok's OAuth authorization page.
 *
 * Query params:
 *   accountId — the SocialAccount ID to bind the tokens to (stored in state)
 *
 * Required env vars:
 *   TIKTOK_CLIENT_ID
 *   TIKTOK_REDIRECT_URI
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.TIKTOK_CLIENT_ID;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "TIKTOK_CLIENT_ID and TIKTOK_REDIRECT_URI must be set in .env" },
      { status: 500 }
    );
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId query param is required" },
      { status: 400 }
    );
  }

  // state = accountId:random — we parse it back in the callback
  const state = `${accountId}:${uuidv4()}`;

  const params = new URLSearchParams({
    client_key: clientId,
    response_type: "code",
    scope: "video.publish",
    redirect_uri: redirectUri,
    state,
  });

  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}
