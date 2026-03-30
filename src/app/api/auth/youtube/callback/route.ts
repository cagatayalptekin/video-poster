import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { exchangeYouTubeCode } from "@/services/publishers/youtube-token-helper";

/**
 * GET /api/auth/youtube/callback — Handle Google OAuth callback.
 *
 * Google redirects here with ?code=...&state=...
 * We exchange the code for tokens and store them on the SocialAccount.
 */
function appUrl(path: string): string {
  const base = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    const desc = error;
    return NextResponse.redirect(appUrl(`/dashboard/accounts?youtube_error=${encodeURIComponent(desc)}`));
  }

  if (!code || !state) {
    return NextResponse.redirect(appUrl("/dashboard/accounts?youtube_error=missing_code_or_state"));
  }

  // Parse state = accountId:nonce
  const colonIdx = state.indexOf(":");
  if (colonIdx === -1) {
    return NextResponse.redirect(appUrl("/dashboard/accounts?youtube_error=invalid_state"));
  }
  const accountId = state.substring(0, colonIdx);

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(appUrl("/dashboard/accounts?youtube_error=missing_env_vars"));
  }

  // Exchange code for tokens
  const tokens = await exchangeYouTubeCode({
    clientId,
    clientSecret,
    code,
    redirectUri,
  });

  if (!tokens) {
    return NextResponse.redirect(appUrl("/dashboard/accounts?youtube_error=token_exchange_failed"));
  }

  // Fetch YouTube channel info to get real channel name
  let channelTitle = "";
  let channelHandle = "";
  try {
    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    if (channelRes.ok) {
      const channelData = await channelRes.json();
      const ch = channelData.items?.[0]?.snippet;
      if (ch) {
        channelTitle = ch.title || "";
        channelHandle = ch.customUrl || ch.title || "";
        console.log(`[YouTubeOAuth] Channel: ${channelTitle} (${channelHandle})`);
      }
    }
  } catch (err) {
    console.warn(`[YouTubeOAuth] Failed to fetch channel info: ${err}`);
  }

  // Update the SocialAccount with tokens and channel info
  try {
    const metadataObj: Record<string, unknown> = { scope: tokens.scope };

    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        authType: "oauth",
        ...(channelTitle && { accountName: channelTitle }),
        ...(channelHandle && { username: channelHandle.replace(/^@/, "") }),
        metadata: JSON.stringify(metadataObj),
      },
    });

    console.log(`[YouTubeOAuth] Tokens stored for account ${accountId}`);

    return NextResponse.redirect(appUrl("/dashboard/accounts?youtube_success=true"));
  } catch (dbErr) {
    console.error(`[YouTubeOAuth] Failed to store tokens: ${dbErr}`);
    return NextResponse.redirect(appUrl("/dashboard/accounts?youtube_error=db_update_failed"));
  }
}
