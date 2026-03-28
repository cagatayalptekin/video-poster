import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

/**
 * GET /api/auth/youtube — Redirect to Google's OAuth authorization page.
 *
 * Query params:
 *   accountId — the SocialAccount ID to bind the tokens to (stored in state)
 *
 * Required env vars:
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_REDIRECT_URI
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "YOUTUBE_CLIENT_ID and YOUTUBE_REDIRECT_URI must be set in .env" },
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
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent", // Force consent to always get a refresh_token
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}
