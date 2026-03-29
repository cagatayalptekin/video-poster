import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  exchangeInstagramCode,
  exchangeForLongLivedToken,
  fetchInstagramBusinessAccountId,
} from "@/services/publishers/instagram-token-helper";

/**
 * GET /api/auth/instagram/callback — Handle Facebook OAuth callback for Instagram.
 *
 * Facebook redirects here with ?code=...&state=...
 * We exchange the code for tokens, get the IG Business Account ID,
 * and store everything on the SocialAccount.
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
    const desc = request.nextUrl.searchParams.get("error_description") || error;
    return NextResponse.redirect(appUrl(`/dashboard/accounts?instagram_error=${encodeURIComponent(desc)}`));
  }

  if (!code || !state) {
    return NextResponse.redirect(appUrl("/dashboard/accounts?instagram_error=missing_code_or_state"));
  }

  // Parse state = accountId:nonce
  const colonIdx = state.indexOf(":");
  if (colonIdx === -1) {
    return NextResponse.redirect(appUrl("/dashboard/accounts?instagram_error=invalid_state"));
  }
  const accountId = state.substring(0, colonIdx);

  const clientId = process.env.INSTAGRAM_APP_ID;
  const clientSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(appUrl("/dashboard/accounts?instagram_error=missing_env_vars"));
  }

  // Step 1: Exchange code for short-lived token
  const shortLivedTokens = await exchangeInstagramCode({
    clientId,
    clientSecret,
    code,
    redirectUri,
  });

  if (!shortLivedTokens) {
    return NextResponse.redirect(appUrl("/dashboard/accounts?instagram_error=token_exchange_failed"));
  }

  // Step 2: Exchange for long-lived token (~60 days)
  const longLivedTokens = await exchangeForLongLivedToken({
    clientId,
    clientSecret,
    shortLivedToken: shortLivedTokens.accessToken,
  });

  const finalToken = longLivedTokens?.accessToken || shortLivedTokens.accessToken;

  // Step 3: Fetch Instagram Business Account ID
  const igAccount = await fetchInstagramBusinessAccountId(finalToken);

  if (!igAccount) {
    return NextResponse.redirect(
      appUrl("/dashboard/accounts?instagram_error=" + encodeURIComponent(
        "No Instagram Business/Creator account found linked to your Facebook Pages. " +
        "Make sure your Instagram account is a Business or Creator account and is connected to a Facebook Page."
      ))
    );
  }

  // Step 4: Update the SocialAccount with tokens and IG metadata
  try {
    const metadataObj: Record<string, unknown> = {
      ig_user_id: igAccount.igUserId,
      page_id: igAccount.pageId,
      page_name: igAccount.pageName,
    };

    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        accessToken: finalToken,
        authType: "oauth",
        accountName: igAccount.pageName,
        metadata: JSON.stringify(metadataObj),
      },
    });

    console.log(`[InstagramOAuth] Tokens stored for account ${accountId}, IG User ID: ${igAccount.igUserId}`);

    return NextResponse.redirect(appUrl("/dashboard/accounts?instagram_success=true"));
  } catch (dbErr) {
    console.error(`[InstagramOAuth] Failed to store tokens: ${dbErr}`);
    return NextResponse.redirect(appUrl("/dashboard/accounts?instagram_error=db_update_failed"));
  }
}
