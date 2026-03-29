/**
 * Instagram / Facebook OAuth token helpers.
 *
 * Instagram Content Publishing API uses Facebook's OAuth 2.0.
 * Token endpoint: POST https://graph.facebook.com/v21.0/oauth/access_token
 * Auth endpoint:  https://www.facebook.com/v21.0/dialog/oauth
 *
 * Required scopes:
 *   instagram_basic
 *   instagram_content_publish
 *   pages_read_engagement
 *   pages_show_list
 *
 * After getting a short-lived token, we exchange it for a long-lived token (60 days).
 */

const GRAPH_API_VERSION = "v21.0";
const TOKEN_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`;

interface RefreshInput {
  clientId: string;
  clientSecret: string;
  accessToken: string; // Long-lived token to refresh
}

interface TokenResult {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

interface FacebookTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

/**
 * Exchange a short-lived token for a long-lived token (valid ~60 days).
 */
export async function exchangeForLongLivedToken(input: {
  clientId: string;
  clientSecret: string;
  shortLivedToken: string;
}): Promise<TokenResult | null> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    fb_exchange_token: input.shortLivedToken,
  });

  const res = await fetch(`${TOKEN_URL}?${params.toString()}`);
  const data: FacebookTokenResponse = await res.json();

  if (data.error || !data.access_token) {
    console.warn(`[InstagramTokenHelper] Long-lived token exchange failed: ${data.error?.message || "no access_token"}`);
    return null;
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 5184000, // ~60 days
    tokenType: data.token_type || "Bearer",
  };
}

/**
 * Refresh a long-lived token. Facebook long-lived tokens can be refreshed
 * once per day, and remain valid for 60 days from refresh.
 */
export async function refreshInstagramToken(input: RefreshInput): Promise<TokenResult | null> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    fb_exchange_token: input.accessToken,
  });

  const res = await fetch(`${TOKEN_URL}?${params.toString()}`);
  const data: FacebookTokenResponse = await res.json();

  if (data.error || !data.access_token) {
    console.warn(`[InstagramTokenHelper] Token refresh failed: ${data.error?.message || "no access_token"}`);
    return null;
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 5184000,
    tokenType: data.token_type || "Bearer",
  };
}

/**
 * Exchange an authorization code for an access token.
 * Used in the OAuth callback.
 */
export async function exchangeInstagramCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TokenResult | null> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(`${TOKEN_URL}?${params.toString()}`);
  const data: FacebookTokenResponse = await res.json();

  if (data.error || !data.access_token) {
    console.warn(`[InstagramTokenHelper] Code exchange failed: ${data.error?.message || "no access_token"}`);
    return null;
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
    tokenType: data.token_type || "Bearer",
  };
}

/**
 * Fetch the Instagram Business Account ID linked to the Facebook Page.
 * The user token must have pages_read_engagement + instagram_basic permissions.
 *
 * Steps:
 * 1. GET /me/accounts → list of Facebook Pages managed by the user
 * 2. For each page, GET /{page-id}?fields=instagram_business_account
 * 3. Return the first instagram_business_account.id found
 */
export async function fetchInstagramBusinessAccountId(accessToken: string): Promise<{
  igUserId: string;
  pageName: string;
  pageId: string;
} | null> {
  const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

  // Step 1: Get user's Facebook Pages
  const pagesRes = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${encodeURIComponent(accessToken)}`);
  const pagesData = await pagesRes.json();

  if (pagesData.error || !pagesData.data) {
    console.warn(`[InstagramTokenHelper] Failed to fetch pages: ${pagesData.error?.message || "no data"}`);
    return null;
  }

  // Step 2: Check each page for linked Instagram Business Account
  for (const page of pagesData.data) {
    const pageRes = await fetch(
      `${GRAPH_BASE}/${page.id}?fields=instagram_business_account,name&access_token=${encodeURIComponent(accessToken)}`
    );
    const pageData = await pageRes.json();

    if (pageData.instagram_business_account?.id) {
      return {
        igUserId: pageData.instagram_business_account.id,
        pageName: pageData.name || page.name || "Unknown Page",
        pageId: page.id,
      };
    }
  }

  console.warn("[InstagramTokenHelper] No Instagram Business Account found linked to any Facebook Page");
  return null;
}
