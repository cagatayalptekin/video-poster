import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { exchangeTikTokCode } from "@/services/publishers/tiktok-token-helper";

/**
 * GET /api/auth/tiktok/callback — Handle TikTok OAuth callback.
 *
 * TikTok redirects here with ?code=...&state=...
 * We exchange the code for tokens and store them on the SocialAccount.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    const desc = request.nextUrl.searchParams.get("error_description") || error;
    return NextResponse.redirect(
      new URL(`/dashboard/accounts?tiktok_error=${encodeURIComponent(desc)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?tiktok_error=missing_code_or_state", request.url)
    );
  }

  // Parse state = accountId:nonce
  const colonIdx = state.indexOf(":");
  if (colonIdx === -1) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?tiktok_error=invalid_state", request.url)
    );
  }
  const accountId = state.substring(0, colonIdx);

  const clientKey = process.env.TIKTOK_CLIENT_ID;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;

  if (!clientKey || !clientSecret || !redirectUri) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?tiktok_error=missing_env_vars", request.url)
    );
  }

  // Exchange code for tokens
  const tokens = await exchangeTikTokCode({
    clientKey,
    clientSecret,
    code,
    redirectUri,
  });

  if (!tokens) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?tiktok_error=token_exchange_failed", request.url)
    );
  }

  // Update the SocialAccount with tokens and open_id
  try {
    const metadataObj: Record<string, unknown> = { open_id: tokens.openId, scope: tokens.scope };

    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        authType: "oauth",
        metadata: JSON.stringify(metadataObj),
      },
    });

    console.log(`[TikTokOAuth] Tokens stored for account ${accountId} (open_id: ${tokens.openId})`);

    return NextResponse.redirect(
      new URL("/dashboard/accounts?tiktok_success=true", request.url)
    );
  } catch (err) {
    console.error(`[TikTokOAuth] Failed to update account ${accountId}:`, err);
    return NextResponse.redirect(
      new URL("/dashboard/accounts?tiktok_error=db_update_failed", request.url)
    );
  }
}
