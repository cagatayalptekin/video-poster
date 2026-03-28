/**
 * TikTok OAuth token refresh helper.
 *
 * Uses the TikTok v2 OAuth endpoint to refresh an access token.
 * Docs: https://developers.tiktok.com/doc/oauth-user-access-token-management
 *
 * Endpoint: POST https://open.tiktokapis.com/v2/oauth/token/
 * Body (x-www-form-urlencoded):
 *   client_key, client_secret, grant_type=refresh_token, refresh_token
 *
 * Returns new access_token + refresh_token, or null on failure.
 */

const API_BASE = process.env.TIKTOK_API_BASE_URL || "https://open.tiktokapis.com";

interface RefreshInput {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  openId: string;
  scope: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Refreshes a TikTok access token using the refresh_token grant.
 * Returns the new tokens or null if the refresh failed.
 * Throws on network/parsing errors.
 */
export async function refreshTikTokToken(input: RefreshInput): Promise<RefreshResult | null> {
  const body = new URLSearchParams({
    client_key: input.clientKey,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });

  const res = await fetch(`${API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: body.toString(),
  });

  const data: TokenResponse = await res.json();

  if (data.error || !data.access_token) {
    console.warn(`[TikTokTokenHelper] Refresh failed: ${data.error || "no access_token"} — ${data.error_description || ""}`);
    return null;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || input.refreshToken,
    expiresIn: data.expires_in || 86400,
    refreshExpiresIn: data.refresh_expires_in || 31536000,
    openId: data.open_id || "",
    scope: data.scope || "",
  };
}

/**
 * Exchanges an authorization code for access + refresh tokens.
 * Used during the OAuth callback flow.
 */
export async function exchangeTikTokCode(input: {
  clientKey: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<RefreshResult | null> {
  const body = new URLSearchParams({
    client_key: input.clientKey,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });

  const res = await fetch(`${API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: body.toString(),
  });

  const data: TokenResponse = await res.json();

  if (data.error || !data.access_token) {
    console.error(`[TikTokTokenHelper] Code exchange failed: ${data.error || "no access_token"} — ${data.error_description || ""}`);
    return null;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: data.expires_in || 86400,
    refreshExpiresIn: data.refresh_expires_in || 31536000,
    openId: data.open_id || "",
    scope: data.scope || "",
  };
}
