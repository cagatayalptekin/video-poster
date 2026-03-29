import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

/**
 * GET /api/auth/instagram — Redirect to Facebook OAuth authorization page.
 *
 * Query params:
 *   accountId — the SocialAccount ID to bind the tokens to (stored in state)
 *
 * Required env vars:
 *   INSTAGRAM_APP_ID (Facebook App ID)
 *   INSTAGRAM_REDIRECT_URI
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "INSTAGRAM_APP_ID and INSTAGRAM_REDIRECT_URI must be set in .env" },
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
    scope: [
      "instagram_basic",
      "instagram_content_publish",
      "pages_show_list",
      "pages_read_engagement",
    ].join(","),
    state,
  });

  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}
