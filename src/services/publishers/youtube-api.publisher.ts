import { PlatformPublisher, PublishInput, PublishResult } from "./types";
import prisma from "../../lib/prisma";
import { refreshYouTubeToken } from "./youtube-token-helper";
import fs from "fs";
import path from "path";

const API_BASE = process.env.YOUTUBE_API_BASE_URL || "https://www.googleapis.com";
const REQUEST_TIMEOUT = Number(process.env.YOUTUBE_REQUEST_TIMEOUT_MS) || 60000;
const DEFAULT_PRIVACY = process.env.YOUTUBE_UPLOAD_PRIVACY_STATUS || "private";
const DEFAULT_CATEGORY_ID = process.env.YOUTUBE_CATEGORY_ID || "22";

// Resumable upload uses 256KB-aligned chunks. We use 5MB chunks.
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB (multiple of 256 KB)

// Shorts thresholds for warning
const SHORTS_MAX_DURATION_SEC = 60;
const SHORTS_MAX_FILE_SIZE_MB = 200; // Rough heuristic; actual limit is duration-based

/** Mask a token for safe logging: show first 6 chars + "..." */
function maskToken(token: string): string {
  if (token.length <= 8) return "***";
  return token.substring(0, 6) + "...";
}

/** Resolve Content-Type for a video file. */
function videoContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    case ".avi": return "video/x-msvideo";
    case ".mkv": return "video/x-matroska";
    default: return "video/mp4";
  }
}

/** Fetch wrapper with configurable timeout. */
async function ytFetch(url: string, options: RequestInit, timeout?: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = timeout ?? REQUEST_TIMEOUT;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Try to derive a title from a caption or filename.
 * YouTube requires a title (max 100 chars).
 */
function deriveTitle(caption: string, filename: string): string {
  // Use caption as title (first line, trimmed, up to 100 chars)
  if (caption) {
    const firstLine = caption.split("\n")[0].trim();
    // Strip leading hashtags for a cleaner title
    const cleaned = firstLine.replace(/^[#\s]+/, "").trim();
    if (cleaned.length > 0) {
      return cleaned.substring(0, 100);
    }
  }
  // Fallback: use the filename without extension
  const base = path.basename(filename, path.extname(filename));
  return base.substring(0, 100) || "Untitled Video";
}

/**
 * Build a description from caption + hashtags.
 */
function buildDescription(caption: string, hashtags: string): string {
  const parts: string[] = [];
  if (caption) parts.push(caption);
  if (hashtags) parts.push(hashtags);
  return parts.join("\n\n").substring(0, 5000);
}

/**
 * Extract tags from hashtags string.
 * E.g. "#shorts #funny #cats" → ["shorts", "funny", "cats"]
 */
function extractTags(hashtags: string): string[] {
  if (!hashtags) return [];
  return hashtags
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 500); // YouTube max ~500 tags total length
}

/**
 * Log a warning if the video file likely doesn't meet Shorts criteria.
 * This does NOT block the upload.
 */
function checkShortsCompatibility(filePath: string, fileSize: number): void {
  const sizeMB = fileSize / (1024 * 1024);
  const ext = path.extname(filePath).toLowerCase();

  if (ext !== ".mp4" && ext !== ".mov" && ext !== ".webm") {
    console.warn(`[YouTubeAPI] ⚠ Shorts warning: file format "${ext}" may not be optimal. MP4 is preferred.`);
  }

  if (sizeMB > SHORTS_MAX_FILE_SIZE_MB) {
    console.warn(`[YouTubeAPI] ⚠ Shorts warning: file is ${sizeMB.toFixed(1)} MB — large for a Short (expected <${SHORTS_MAX_FILE_SIZE_MB} MB). Video may be too long.`);
  }

  // We can't easily check duration without ffprobe, so just log a heuristic note
  // A rough rule: 10 MB/min at medium quality → 200 MB ≈ 20 min (way over 60s)
  // For typical Shorts ≤60s at decent quality, files are usually <50 MB
  if (sizeMB > 50) {
    console.warn(`[YouTubeAPI] ⚠ Shorts warning: file is ${sizeMB.toFixed(1)} MB — may exceed ${SHORTS_MAX_DURATION_SEC}s duration limit for Shorts classification.`);
  } else {
    console.log(`[YouTubeAPI] Shorts check: ${sizeMB.toFixed(1)} MB — appears Shorts-compatible by size.`);
  }
}

// ─── YouTube API response types ─────────────────────────────

interface YouTubeVideoResource {
  kind?: string;
  etag?: string;
  id?: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    title?: string;
    description?: string;
    thumbnails?: Record<string, unknown>;
    channelTitle?: string;
    tags?: string[];
    categoryId?: string;
  };
  status?: {
    uploadStatus?: string;
    failureReason?: string;
    rejectionReason?: string;
    privacyStatus?: string;
    publishAt?: string;
    license?: string;
    embeddable?: boolean;
    publicStatsViewable?: boolean;
    madeForKids?: boolean;
    selfDeclaredMadeForKids?: boolean;
  };
}

interface YouTubeErrorResponse {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{
      domain?: string;
      reason?: string;
      message?: string;
    }>;
  };
}

// ─── Publisher ───────────────────────────────────────────────

/**
 * Real YouTube publisher using the YouTube Data API v3 with resumable upload.
 *
 * Flow:
 *   1. Validate inputs (file, tokens)
 *   2. Refresh access token if possible
 *   3. Log Shorts-compatibility warnings
 *   4. Initiate resumable upload session (POST with video metadata)
 *   5. Upload video in chunks via PUT to the session URI
 *   6. Parse response for video ID and URL
 *   7. Return structured PublishResult
 *
 * Requires on the SocialAccount record:
 *   - accessToken: valid Google OAuth access token
 *   - refreshToken: for auto-refresh
 *
 * Requires env vars:
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 */
export class YouTubeApiPublisher implements PlatformPublisher {
  platform = "youtube";

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
        return this.fail("YouTube account is missing an access token. Complete OAuth first.");
      }

      console.log(`[YouTubeAPI] Starting publish for account ${input.accountId}`);
      console.log(`[YouTubeAPI] Video: ${input.filePath} (${(videoSize / 1024 / 1024).toFixed(1)} MB)`);
      console.log(`[YouTubeAPI] Access token: ${maskToken(accessToken)}`);

      // ──────────────────────────────────────────
      // STEP 2: Refresh token if possible
      // ──────────────────────────────────────────
      currentStep = "token-refresh";

      const clientId = process.env.YOUTUBE_CLIENT_ID;
      const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

      if (clientId && clientSecret && refreshToken) {
        console.log("[YouTubeAPI] Attempting proactive token refresh...");
        try {
          const refreshed = await refreshYouTubeToken({
            clientId,
            clientSecret,
            refreshToken,
          });

          if (refreshed) {
            accessToken = refreshed.accessToken;
            console.log(`[YouTubeAPI] Token refreshed successfully. New token: ${maskToken(accessToken)}`);

            // Persist the new tokens to the SocialAccount
            try {
              await prisma.socialAccount.update({
                where: { id: input.accountId },
                data: {
                  accessToken: refreshed.accessToken,
                  refreshToken: refreshed.refreshToken,
                },
              });
              console.log("[YouTubeAPI] Updated tokens in database");
            } catch (dbErr) {
              console.warn(`[YouTubeAPI] Failed to persist refreshed tokens: ${dbErr}`);
            }
          } else {
            console.warn("[YouTubeAPI] Token refresh returned null — using existing access token");
          }
        } catch (refreshErr) {
          console.warn(`[YouTubeAPI] Token refresh failed (will try existing token): ${refreshErr instanceof Error ? refreshErr.message : refreshErr}`);
        }
      } else if (!refreshToken) {
        console.log("[YouTubeAPI] No refresh token available — using existing access token");
      } else {
        console.log("[YouTubeAPI] YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET not set — skipping token refresh");
      }

      // ──────────────────────────────────────────
      // STEP 3: Shorts compatibility check
      // ──────────────────────────────────────────
      currentStep = "shorts-check";
      checkShortsCompatibility(videoPath, videoSize);

      // ──────────────────────────────────────────
      // STEP 4: Build video metadata
      // ──────────────────────────────────────────
      currentStep = "build-metadata";

      const title = deriveTitle(input.caption, input.filePath);
      const description = buildDescription(input.caption, input.hashtags);
      const tags = extractTags(input.hashtags);

      // Add #Shorts to title if not already present (helps YouTube classify as Short)
      const titleWithShorts = title.toLowerCase().includes("#shorts")
        ? title
        : `${title} #Shorts`.substring(0, 100);

      const videoResource = {
        snippet: {
          title: titleWithShorts,
          description,
          tags: tags.length > 0 ? tags : undefined,
          categoryId: DEFAULT_CATEGORY_ID,
        },
        status: {
          privacyStatus: DEFAULT_PRIVACY,
          selfDeclaredMadeForKids: false,
        },
      };

      const metadataJson = JSON.stringify(videoResource);
      const contentType = videoContentType(videoPath);

      console.log(`[YouTubeAPI] Title: "${titleWithShorts}"`);
      console.log(`[YouTubeAPI] Privacy: ${DEFAULT_PRIVACY}`);
      console.log(`[YouTubeAPI] Category: ${DEFAULT_CATEGORY_ID}`);
      console.log(`[YouTubeAPI] Tags: ${tags.length > 0 ? tags.join(", ") : "(none)"}`);

      // ──────────────────────────────────────────
      // STEP 5: Initiate resumable upload
      // ──────────────────────────────────────────
      currentStep = "init-upload";
      console.log("[YouTubeAPI] Initiating resumable upload session...");

      const initUrl = `${API_BASE}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`;

      const initRes = await ytFetch(initUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "Content-Length": String(Buffer.byteLength(metadataJson, "utf-8")),
          "X-Upload-Content-Length": String(videoSize),
          "X-Upload-Content-Type": contentType,
        },
        body: metadataJson,
      });

      if (!initRes.ok) {
        const errorBody = await initRes.text();
        let parsed: YouTubeErrorResponse | null = null;
        try { parsed = JSON.parse(errorBody); } catch { /* not JSON */ }

        const errMsg = parsed?.error?.message || errorBody;
        const errCode = parsed?.error?.code || initRes.status;
        const errReason = parsed?.error?.errors?.[0]?.reason || "";

        if (initRes.status === 401) {
          return this.fail(`YouTube auth failed (401): ${errMsg}. Re-authorize the account via OAuth.`);
        }
        if (initRes.status === 403) {
          return this.fail(`YouTube API forbidden (403): ${errMsg}. Check quota, API enablement, or scope. Reason: ${errReason}`);
        }
        return this.fail(`Resumable upload init failed (HTTP ${errCode}): ${errMsg}`);
      }

      const uploadUrl = initRes.headers.get("location");
      if (!uploadUrl) {
        return this.fail("Resumable upload init succeeded but no Location header returned");
      }

      console.log("[YouTubeAPI] Resumable session created. Upload URL received.");

      // ──────────────────────────────────────────
      // STEP 6: Upload video in chunks
      // ──────────────────────────────────────────
      currentStep = "upload-video";
      console.log(`[YouTubeAPI] Uploading video (${(videoSize / 1024 / 1024).toFixed(1)} MB) in chunks...`);

      let uploadResponse: Response | null = null;

      if (videoSize <= CHUNK_SIZE) {
        // Small file: single PUT
        console.log("[YouTubeAPI] File small enough for single-request upload");
        const fileBuffer = fs.readFileSync(videoPath);

        uploadResponse = await ytFetch(uploadUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Length": String(videoSize),
            "Content-Type": contentType,
          },
          body: fileBuffer,
        }, REQUEST_TIMEOUT * 5); // Allow extra time for upload

      } else {
        // Chunked upload
        const totalChunks = Math.ceil(videoSize / CHUNK_SIZE);
        console.log(`[YouTubeAPI] Uploading in ${totalChunks} chunks (${(CHUNK_SIZE / 1024 / 1024).toFixed(0)} MB each)`);

        const fd = fs.openSync(videoPath, "r");
        try {
          for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, videoSize);
            const thisChunkSize = end - start;
            const buffer = Buffer.alloc(thisChunkSize);
            fs.readSync(fd, buffer, 0, thisChunkSize, start);

            const isLast = i === totalChunks - 1;
            console.log(`[YouTubeAPI] Uploading chunk ${i + 1}/${totalChunks} (bytes ${start}-${end - 1}/${videoSize})`);

            const chunkRes = await ytFetch(uploadUrl, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Length": String(thisChunkSize),
                "Content-Type": contentType,
                "Content-Range": `bytes ${start}-${end - 1}/${videoSize}`,
              },
              body: buffer,
            }, REQUEST_TIMEOUT * 3);

            if (isLast) {
              // Last chunk: expect 200 or 201
              uploadResponse = chunkRes;
            } else {
              // Intermediate chunk: expect 308 Resume Incomplete
              if (chunkRes.status !== 308 && !chunkRes.ok) {
                const errText = await chunkRes.text();
                return this.fail(`Chunk ${i + 1} upload failed (HTTP ${chunkRes.status}): ${errText}`);
              }
              // 200/201 early could mean the upload completed before all chunks (unlikely but handle it)
              if (chunkRes.ok) {
                console.log(`[YouTubeAPI] Upload completed early at chunk ${i + 1}`);
                uploadResponse = chunkRes;
                break;
              }
            }
          }
        } finally {
          fs.closeSync(fd);
        }
      }

      // ──────────────────────────────────────────
      // STEP 7: Parse upload response
      // ──────────────────────────────────────────
      currentStep = "parse-response";

      if (!uploadResponse) {
        return this.fail("Upload did not produce a final response");
      }

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        let parsed: YouTubeErrorResponse | null = null;
        try { parsed = JSON.parse(errText); } catch { /* not JSON */ }

        const errMsg = parsed?.error?.message || errText;
        const errCode = parsed?.error?.code || uploadResponse.status;

        if (uploadResponse.status === 401) {
          return this.fail(`YouTube upload auth failed (401): ${errMsg}. Token may have expired during upload.`);
        }
        if (uploadResponse.status === 403) {
          return this.fail(`YouTube upload forbidden (403): ${errMsg}. Possible quota exhaustion.`);
        }
        return this.fail(`Video upload failed (HTTP ${errCode}): ${errMsg}`);
      }

      const videoData: YouTubeVideoResource = await uploadResponse.json();
      const videoId = videoData.id;
      const uploadStatus = videoData.status?.uploadStatus;
      const channelId = videoData.snippet?.channelId;

      if (!videoId) {
        return this.fail("Upload response did not contain a video ID");
      }

      console.log(`[YouTubeAPI] Upload complete! Video ID: ${videoId}`);
      console.log(`[YouTubeAPI] Upload status: ${uploadStatus || "unknown"}`);
      console.log(`[YouTubeAPI] Channel: ${channelId || "unknown"}`);

      if (uploadStatus === "rejected") {
        const reason = videoData.status?.rejectionReason || "unknown";
        return this.fail(`Video was rejected by YouTube: ${reason}`);
      }

      if (uploadStatus === "failed") {
        const reason = videoData.status?.failureReason || "unknown";
        return this.fail(`Video upload processing failed: ${reason}`);
      }

      // For Shorts, the URL format is youtube.com/shorts/VIDEO_ID
      // But we can't definitively know if YouTube classified it as a Short
      // Use the standard watch URL; YouTube will redirect to /shorts/ if applicable
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      console.log(`[YouTubeAPI] Video URL: ${videoUrl}`);
      console.log(`[YouTubeAPI] Privacy: ${videoData.status?.privacyStatus || DEFAULT_PRIVACY}`);
      console.log("[YouTubeAPI] Publish complete.");

      return {
        success: true,
        externalPostId: videoId,
        externalUrl: videoUrl,
      };

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      if (errMsg.includes("AbortError") || errMsg.includes("aborted")) {
        return this.fail(`Request timed out during "${currentStep}". The YouTube API did not respond in time.`);
      }

      return this.fail(`Unexpected error during "${currentStep}": ${errMsg}`);
    }
  }

  private fail(message: string): PublishResult {
    console.error(`[YouTubeAPI] ERROR: ${message}`);
    return { success: false, errorMessage: message };
  }
}
