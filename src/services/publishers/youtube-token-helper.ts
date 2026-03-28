/**
 * YouTube / Google OAuth token helpers.
 *
 * Uses standard Google OAuth 2.0 endpoints:
 *   Token: POST https://oauth2.googleapis.com/token
 *   Auth:  https://accounts.google.com/o/oauth2/v2/auth
 *
 * Scopes needed for video upload:
 *   https://www.googleapis.com/auth/youtube.upload
 *   https://www.googleapis.com/auth/youtube (for reading channel info)
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface RefreshInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Refreshes a Google/YouTube access token using the refresh_token grant.
 * Google refresh tokens do not rotate by default, so the original refresh_token
 * stays valid unless the user revokes access.
 */
export async function refreshYouTubeToken(input: RefreshInput): Promise<TokenResult | null> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data: GoogleTokenResponse = await res.json();

  if (data.error || !data.access_token) {
    console.warn(`[YouTubeTokenHelper] Refresh failed: ${data.error || "no access_token"} — ${data.error_description || ""}`);
    return null;
  }

  return {
    accessToken: data.access_token,
    // Google does not always return a new refresh_token on refresh — keep the old one
    refreshToken: data.refresh_token || input.refreshToken,
    expiresIn: data.expires_in || 3600,
    scope: data.scope || "",
    tokenType: data.token_type || "Bearer",
  };
}

/**
 * Exchanges an authorization code for access + refresh tokens.
 * Used in the OAuth callback.
 */
export async function exchangeYouTubeCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TokenResult | null> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data: GoogleTokenResponse = await res.json();

  if (data.error || !data.access_token) {
    console.warn(`[YouTubeTokenHelper] Code exchange failed: ${data.error || "no access_token"} — ${data.error_description || ""}`);
    return null;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: data.expires_in || 3600,
    scope: data.scope || "",
    tokenType: data.token_type || "Bearer",
  };
}
