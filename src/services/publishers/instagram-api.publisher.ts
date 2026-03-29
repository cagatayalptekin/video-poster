import { PlatformPublisher, PublishInput, PublishResult } from "./types";
import prisma from "../../lib/prisma";
import { refreshInstagramToken } from "./instagram-token-helper";
import fs from "fs";
import path from "path";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const REQUEST_TIMEOUT = Number(process.env.INSTAGRAM_REQUEST_TIMEOUT_MS) || 60000;

// Status polling: check every 5s, up to 5 minutes
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60;

function maskToken(token: string): string {
  if (token.length <= 8) return "***";
  return token.substring(0, 6) + "...";
}

async function igFetch(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Instagram Graph API publisher for Reels.
 *
 * Uses the Instagram Content Publishing API:
 * 1. Create a media container (Reel) with video_url
 * 2. Poll container status until FINISHED
 * 3. Publish the container
 *
 * Required env vars:
 *   INSTAGRAM_APP_ID (Facebook App ID)
 *   INSTAGRAM_APP_SECRET (Facebook App Secret)
 *
 * The access token and IG User ID are stored on the SocialAccount record
 * (obtained via the /api/auth/instagram OAuth flow).
 *
 * metadata.ig_user_id — the Instagram Business Account ID
 * metadata.page_id — the linked Facebook Page ID
 */
export class InstagramApiPublisher implements PlatformPublisher {
  platform = "instagram";

  async publishVideo(input: PublishInput): Promise<PublishResult> {
    const clientId = process.env.INSTAGRAM_APP_ID;
    const clientSecret = process.env.INSTAGRAM_APP_SECRET;

    if (!clientId || !clientSecret) {
      return {
        success: false,
        errorMessage: "INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET env vars are required",
      };
    }

    // Validate access token
    let accessToken = input.accessToken;
    if (!accessToken) {
      return {
        success: false,
        errorMessage: "No access token for Instagram account. Connect via OAuth first.",
      };
    }

    // Get IG User ID from metadata
    const igUserId = input.metadata?.ig_user_id as string | undefined;
    if (!igUserId) {
      return {
        success: false,
        errorMessage: "No Instagram Business Account ID (ig_user_id) in account metadata. Reconnect via OAuth.",
      };
    }

    // Validate file exists
    const videoPath = path.resolve(input.filePath);
    if (!fs.existsSync(videoPath)) {
      return { success: false, errorMessage: `Video file not found: ${input.filePath}` };
    }

    const fileSize = fs.statSync(videoPath).size;
    console.log(`[InstagramAPI] Publishing Reel: ${path.basename(videoPath)} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`[InstagramAPI] IG User ID: ${igUserId}, token: ${maskToken(accessToken)}`);

    // ── Step 0: Refresh token if possible ──
    try {
      const refreshResult = await refreshInstagramToken({
        clientId,
        clientSecret,
        accessToken,
      });
      if (refreshResult) {
        accessToken = refreshResult.accessToken;
        // Update stored token
        await prisma.socialAccount.update({
          where: { id: input.accountId },
          data: { accessToken: refreshResult.accessToken },
        });
        console.log(`[InstagramAPI] Token refreshed successfully`);
      }
    } catch (err) {
      console.warn(`[InstagramAPI] Token refresh failed (non-fatal): ${err}`);
    }

    // ── Step 1: Upload video to get a public URL ──
    // Instagram Graph API requires a publicly accessible video URL.
    // We'll use the app's own URL to serve the video.
    const appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL;
    if (!appUrl) {
      return {
        success: false,
        errorMessage: "APP_URL env var is required for Instagram API (video must be publicly accessible)",
      };
    }

    // Serve video from uploads directory via the app's public URL
    const storedFilename = path.basename(videoPath);
    const videoUrl = `${appUrl.replace(/\/$/, "")}/api/videos/serve/${storedFilename}`;
    console.log(`[InstagramAPI] Video URL for Instagram: ${videoUrl}`);

    // ── Step 2: Create media container ──
    try {
      const containerParams = new URLSearchParams({
        media_type: "REELS",
        video_url: videoUrl,
        caption: input.caption || "",
        access_token: accessToken,
      });

      console.log(`[InstagramAPI] Creating Reel container...`);
      const containerRes = await igFetch(
        `${GRAPH_BASE}/${igUserId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: containerParams.toString(),
        }
      );

      const containerData = await containerRes.json();

      if (containerData.error) {
        return {
          success: false,
          errorMessage: `Instagram container creation failed: ${containerData.error.message} (code: ${containerData.error.code})`,
        };
      }

      const containerId = containerData.id;
      if (!containerId) {
        return {
          success: false,
          errorMessage: `Instagram container creation returned no ID: ${JSON.stringify(containerData)}`,
        };
      }

      console.log(`[InstagramAPI] Container created: ${containerId}`);

      // ── Step 3: Poll container status until FINISHED ──
      console.log(`[InstagramAPI] Polling container status...`);
      let status = "IN_PROGRESS";
      let attempts = 0;

      while (status === "IN_PROGRESS" && attempts < POLL_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        attempts++;

        const statusRes = await igFetch(
          `${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
          { method: "GET" }
        );
        const statusData = await statusRes.json();

        if (statusData.error) {
          return {
            success: false,
            errorMessage: `Instagram status check failed: ${statusData.error.message}`,
          };
        }

        status = statusData.status_code || "UNKNOWN";
        console.log(`[InstagramAPI] Container status (attempt ${attempts}): ${status}`);

        if (status === "ERROR" || status === "EXPIRED") {
          return {
            success: false,
            errorMessage: `Instagram container processing failed: status=${status}`,
          };
        }
      }

      if (status !== "FINISHED") {
        return {
          success: false,
          errorMessage: `Instagram container processing timed out after ${attempts} attempts (status: ${status})`,
        };
      }

      // ── Step 4: Publish the container ──
      console.log(`[InstagramAPI] Publishing Reel...`);
      const publishParams = new URLSearchParams({
        creation_id: containerId,
        access_token: accessToken,
      });

      const publishRes = await igFetch(
        `${GRAPH_BASE}/${igUserId}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: publishParams.toString(),
        }
      );

      const publishData = await publishRes.json();

      if (publishData.error) {
        return {
          success: false,
          errorMessage: `Instagram publish failed: ${publishData.error.message} (code: ${publishData.error.code})`,
        };
      }

      const mediaId = publishData.id;
      console.log(`[InstagramAPI] Reel published! Media ID: ${mediaId}`);

      // ── Step 5: Get permalink ──
      let permalink = "";
      try {
        const mediaRes = await igFetch(
          `${GRAPH_BASE}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`,
          { method: "GET" }
        );
        const mediaData = await mediaRes.json();
        permalink = mediaData.permalink || "";
      } catch { /* non-fatal */ }

      return {
        success: true,
        externalPostId: mediaId,
        externalUrl: permalink || `https://www.instagram.com/reel/${mediaId}/`,
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        errorMessage: `Instagram API error: ${msg}`,
      };
    }
  }
}
