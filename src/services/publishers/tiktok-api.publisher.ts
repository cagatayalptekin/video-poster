import { PlatformPublisher, PublishInput, PublishResult } from "./types";
import prisma from "../../lib/prisma";
import { refreshTikTokToken } from "./tiktok-token-helper";
import fs from "fs";
import path from "path";

const API_BASE = process.env.TIKTOK_API_BASE_URL || "https://open.tiktokapis.com";
const REQUEST_TIMEOUT = Number(process.env.TIKTOK_REQUEST_TIMEOUT_MS) || 60000;

// Max 20 MB per chunk; TikTok recommends chunking for files larger than 64MB.
// For simplicity we send the entire file as a single chunk for files <= 64MB,
// and use multi-chunk for larger files.
const SINGLE_CHUNK_LIMIT = 64 * 1024 * 1024; // 64 MB
const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

// Status polling: check every 5s, up to 5 minutes total
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60;

/** Mask a token for safe logging: show first 6 chars + "..." */
function maskToken(token: string): string {
  if (token.length <= 8) return "***";
  return token.substring(0, 6) + "...";
}

/**
 * Resolve the Content-Type for a video file based on extension.
 */
function videoContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    default: return "video/mp4";
  }
}

/**
 * Generic fetch wrapper with timeout and error logging.
 */
async function tiktokFetch(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── TikTok API response shapes ────────────────────────────

interface TikTokError {
  code: string;
  message: string;
  log_id?: string;
}

interface CreatorInfoResponse {
  data?: {
    creator_avatar_url?: string;
    creator_username?: string;
    creator_nickname?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  };
  error: TikTokError;
}

interface PublishInitResponse {
  data?: {
    publish_id?: string;
    upload_url?: string;
  };
  error: TikTokError;
}

interface PublishStatusResponse {
  data?: {
    status?: string;
    fail_reason?: string;
    publicaly_available_post_id?: number[];
    uploaded_bytes?: number;
  };
  error: TikTokError;
}

// ─── Publisher ──────────────────────────────────────────────

/**
 * Real TikTok publisher using the official Content Posting API.
 *
 * Flow:
 *   1. Validate inputs (file, tokens)
 *   2. Attempt token refresh if client credentials are available
 *   3. Query creator info (get privacy_level_options)
 *   4. Initialize direct-post upload (FILE_UPLOAD)
 *   5. Upload video binary to upload_url
 *   6. Poll publish status until PUBLISH_COMPLETE or FAILED
 *   7. Return structured PublishResult
 *
 * Requires on the SocialAccount record:
 *   - accessToken: valid TikTok user access token (Bearer)
 *   - refreshToken: for auto-refresh
 *
 * Requires env vars:
 *   TIKTOK_CLIENT_ID   (client_key)
 *   TIKTOK_CLIENT_SECRET
 */
export class TikTokApiPublisher implements PlatformPublisher {
  platform = "tiktok";

  async publishVideo(input: PublishInput): Promise<PublishResult> {
    let currentStep = "validate";

    try {
      // ──────────────────────────────────────────
      // STEP 1: Validate inputs
      // ──────────────────────────────────────────
      const videoPath = path.resolve(input.filePath);
      if (!fs.existsSync(videoPath)) {
        return this.fail(`Video file not found: ${input.filePath}`);
      }

      const fileStat = fs.statSync(videoPath);
      const videoSize = fileStat.size;
      if (videoSize === 0) {
        return this.fail("Video file is empty");
      }

      let accessToken: string = input.accessToken || "";
      const refreshToken = input.refreshToken;

      if (!accessToken) {
        return this.fail("TikTok account is missing an access token. Complete OAuth first.");
      }

      console.log(`[TikTokAPI] Starting publish for account ${input.accountId}`);
      console.log(`[TikTokAPI] Video: ${input.filePath} (${(videoSize / 1024 / 1024).toFixed(1)} MB)`);
      console.log(`[TikTokAPI] Access token: ${maskToken(accessToken)}`);

      // ──────────────────────────────────────────
      // STEP 2: Refresh token if possible
      // ──────────────────────────────────────────
      currentStep = "token-refresh";

      const clientKey = process.env.TIKTOK_CLIENT_ID;
      const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

      if (clientKey && clientSecret && refreshToken) {
        console.log("[TikTokAPI] Attempting proactive token refresh...");
        try {
          const refreshed = await refreshTikTokToken({
            clientKey,
            clientSecret,
            refreshToken,
          });

          if (refreshed) {
            accessToken = refreshed.accessToken;
            console.log(`[TikTokAPI] Token refreshed successfully. New token: ${maskToken(accessToken)}`);

            // Persist the new tokens to the SocialAccount
            try {
              await prisma.socialAccount.update({
                where: { id: input.accountId },
                data: {
                  accessToken: refreshed.accessToken,
                  refreshToken: refreshed.refreshToken,
                },
              });
              console.log("[TikTokAPI] Updated tokens in database");
            } catch (dbErr) {
              console.warn(`[TikTokAPI] Failed to persist refreshed tokens: ${dbErr}`);
            }
          }
        } catch (refreshErr) {
          // Non-fatal: try with the existing token
          console.warn(`[TikTokAPI] Token refresh failed (will try existing token): ${refreshErr instanceof Error ? refreshErr.message : refreshErr}`);
        }
      } else if (!refreshToken) {
        console.log("[TikTokAPI] No refresh token available — using existing access token");
      } else {
        console.log("[TikTokAPI] TIKTOK_CLIENT_ID or TIKTOK_CLIENT_SECRET not set — skipping token refresh");
      }

      // ──────────────────────────────────────────
      // STEP 3: Query creator info
      // ──────────────────────────────────────────
      currentStep = "creator-info";
      console.log("[TikTokAPI] Querying creator info...");

      const creatorRes = await tiktokFetch(`${API_BASE}/v2/post/publish/creator_info/query/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      });

      const creatorData: CreatorInfoResponse = await creatorRes.json();

      if (creatorData.error?.code !== "ok") {
        if (creatorData.error?.code === "access_token_invalid") {
          return this.fail("TikTok access token is invalid or expired. Re-authorize the account via OAuth.");
        }
        return this.fail(`Creator info query failed: [${creatorData.error?.code}] ${creatorData.error?.message}`);
      }

      const privacyOptions = creatorData.data?.privacy_level_options || [];
      console.log(`[TikTokAPI] Creator: ${creatorData.data?.creator_username || "unknown"}`);
      console.log(`[TikTokAPI] Privacy options: ${privacyOptions.join(", ")}`);

      // Pick the best privacy level: prefer SELF_ONLY for unaudited clients,
      // fall back through the available options
      let privacyLevel: string;
      if (privacyOptions.includes("SELF_ONLY")) {
        privacyLevel = "SELF_ONLY";
      } else if (privacyOptions.includes("PUBLIC_TO_EVERYONE")) {
        privacyLevel = "PUBLIC_TO_EVERYONE";
      } else if (privacyOptions.length > 0) {
        privacyLevel = privacyOptions[0];
      } else {
        privacyLevel = "SELF_ONLY";
      }
      console.log(`[TikTokAPI] Using privacy level: ${privacyLevel}`);

      // ──────────────────────────────────────────
      // STEP 4: Initialize direct post
      // ──────────────────────────────────────────
      currentStep = "init-post";
      console.log("[TikTokAPI] Initializing direct post (FILE_UPLOAD)...");

      const useSingleChunk = videoSize <= SINGLE_CHUNK_LIMIT;
      const chunkSize = useSingleChunk ? videoSize : DEFAULT_CHUNK_SIZE;
      const totalChunks = useSingleChunk ? 1 : Math.ceil(videoSize / chunkSize);

      const initBody = {
        post_info: {
          title: (input.caption || "").substring(0, 2200),
          privacy_level: privacyLevel,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      };

      const initRes = await tiktokFetch(`${API_BASE}/v2/post/publish/video/init/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(initBody),
      });

      const initData: PublishInitResponse = await initRes.json();

      if (initData.error?.code !== "ok") {
        return this.fail(`Post init failed: [${initData.error?.code}] ${initData.error?.message} (log_id: ${initData.error?.log_id || "none"})`);
      }

      const publishId = initData.data?.publish_id;
      const uploadUrl = initData.data?.upload_url;

      if (!publishId || !uploadUrl) {
        return this.fail("Post init succeeded but publish_id or upload_url is missing from response");
      }

      console.log(`[TikTokAPI] Post initialized. publish_id: ${publishId}`);
      console.log(`[TikTokAPI] Upload URL received (${totalChunks} chunk${totalChunks > 1 ? "s" : ""})`);

      // ──────────────────────────────────────────
      // STEP 5: Upload video to upload_url
      // ──────────────────────────────────────────
      currentStep = "upload-video";
      console.log("[TikTokAPI] Uploading video...");

      const contentType = videoContentType(videoPath);

      if (useSingleChunk) {
        // Single-chunk upload
        const fileBuffer = fs.readFileSync(videoPath);
        const uploadRes = await tiktokFetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(videoSize),
            "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
          },
          body: fileBuffer,
        });

        if (!uploadRes.ok) {
          const uploadText = await uploadRes.text();
          return this.fail(`Video upload failed (HTTP ${uploadRes.status}): ${uploadText}`);
        }

        console.log("[TikTokAPI] Single-chunk upload complete");
      } else {
        // Multi-chunk upload
        const fd = fs.openSync(videoPath, "r");
        try {
          for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, videoSize);
            const thisChunkSize = end - start;
            const buffer = Buffer.alloc(thisChunkSize);
            fs.readSync(fd, buffer, 0, thisChunkSize, start);

            console.log(`[TikTokAPI] Uploading chunk ${i + 1}/${totalChunks} (bytes ${start}-${end - 1}/${videoSize})`);

            const chunkRes = await tiktokFetch(uploadUrl, {
              method: "PUT",
              headers: {
                "Content-Type": contentType,
                "Content-Length": String(thisChunkSize),
                "Content-Range": `bytes ${start}-${end - 1}/${videoSize}`,
              },
              body: buffer,
            });

            if (!chunkRes.ok) {
              const chunkText = await chunkRes.text();
              return this.fail(`Chunk ${i + 1} upload failed (HTTP ${chunkRes.status}): ${chunkText}`);
            }
          }
          console.log("[TikTokAPI] Multi-chunk upload complete");
        } finally {
          fs.closeSync(fd);
        }
      }

      // ──────────────────────────────────────────
      // STEP 6: Poll publish status
      // ──────────────────────────────────────────
      currentStep = "poll-status";
      console.log("[TikTokAPI] Polling publish status...");

      let finalStatus: string | undefined;
      let failReason: string | undefined;
      let postIds: number[] | undefined;

      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        const statusRes = await tiktokFetch(`${API_BASE}/v2/post/publish/status/fetch/`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({ publish_id: publishId }),
        });

        const statusData: PublishStatusResponse = await statusRes.json();

        if (statusData.error?.code !== "ok") {
          console.warn(`[TikTokAPI] Status poll error: [${statusData.error?.code}] ${statusData.error?.message}`);
          // Continue polling — might be a transient error
          continue;
        }

        finalStatus = statusData.data?.status;
        failReason = statusData.data?.fail_reason;
        postIds = statusData.data?.publicaly_available_post_id;

        console.log(`[TikTokAPI] Poll ${attempt + 1}: status=${finalStatus}${failReason ? ` reason=${failReason}` : ""}${postIds?.length ? ` post_ids=${postIds.join(",")}` : ""}`);

        if (finalStatus === "PUBLISH_COMPLETE") {
          break;
        }

        if (finalStatus === "FAILED") {
          break;
        }

        // Still processing — continue polling
      }

      // ──────────────────────────────────────────
      // STEP 7: Return result
      // ──────────────────────────────────────────
      currentStep = "result";

      if (finalStatus === "PUBLISH_COMPLETE") {
        const postId = postIds && postIds.length > 0 ? String(postIds[0]) : publishId;
        const externalUrl = postIds && postIds.length > 0
          ? `https://www.tiktok.com/@${creatorData.data?.creator_username || "user"}/video/${postIds[0]}`
          : undefined;

        console.log(`[TikTokAPI] Publish complete! post_id: ${postId}`);
        return {
          success: true,
          externalPostId: postId,
          externalUrl,
        };
      }

      if (finalStatus === "FAILED") {
        return this.fail(`TikTok publish failed: ${failReason || "unknown reason"} (publish_id: ${publishId})`);
      }

      // Timed out waiting
      return this.fail(`TikTok publish status polling timed out after ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000}s. Last status: ${finalStatus || "unknown"} (publish_id: ${publishId})`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      if (errMsg.includes("AbortError") || errMsg.includes("aborted")) {
        return this.fail(`Request timed out during "${currentStep}". The TikTok API did not respond in time.`);
      }

      return this.fail(`Unexpected error during "${currentStep}": ${errMsg}`);
    }
  }

  private fail(message: string): PublishResult {
    console.error(`[TikTokAPI] ERROR: ${message}`);
    return { success: false, errorMessage: message };
  }
}
