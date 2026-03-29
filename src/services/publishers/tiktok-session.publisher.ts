import { chromium, Browser, BrowserContext, Page } from "playwright";
import { PlatformPublisher, PublishInput, PublishResult } from "./types";
import path from "path";
import fs from "fs";

const SCREENSHOT_DIR = path.resolve("./debug-screenshots");

// ─── Helpers ───────────────────────────────────────────────

function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

async function saveDebugScreenshot(page: Page, stepName: string): Promise<string> {
  ensureScreenshotDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `tt-${stepName}-${timestamp}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  try {
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`[TikTokSession] Debug screenshot saved: ${filepath}`);
  } catch (err) {
    console.error(`[TikTokSession] Failed to save screenshot: ${err}`);
  }
  return filepath;
}

async function humanDelay(minMs = 800, maxMs = 2500): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  await new Promise((r) => setTimeout(r, delay));
}

/**
 * Parse session cookies from the account record.
 *
 * Expected format for accessToken: the raw `sessionid` cookie value
 * Expected format for metadata JSON: { "tt_target_idc": "useast2a", "cookies": [...] }
 *   OR just: { "sessionid": "xxx", "tt_target_idc": "yyy" }
 */
function parseSessionCookies(
  accessToken?: string,
  metadata?: Record<string, unknown>
): { sessionId: string; dcId: string } | null {
  // Try metadata first (may have both values)
  if (metadata) {
    const sid = (metadata.sessionid as string) || (accessToken as string);
    const dc = (metadata.tt_target_idc as string) || "useast2a";
    if (sid) {
      return { sessionId: sid, dcId: dc };
    }
  }

  // Fall back to accessToken as sessionid
  if (accessToken) {
    return { sessionId: accessToken, dcId: "useast2a" };
  }

  return null;
}

// ─── Publisher ──────────────────────────────────────────────

/**
 * TikTok publisher using Playwright browser automation with session cookies.
 *
 * This approach is adapted from github.com/makiisthenes/TiktokAutoUploader
 * and github.com/wanghaisheng/tiktoka-studio-uploader.
 *
 * Instead of reverse-engineering TikTok's internal APIs and signature generation,
 * we use Playwright to drive the TikTok upload page directly — the browser handles
 * all authentication, signing, and CSRF protection natively.
 *
 * Prerequisites:
 *   - A valid TikTok `sessionid` cookie (from the user's browser)
 *   - Optionally a `tt-target-idc` cookie for datacenter routing
 *
 * How to get the sessionid:
 *   1. Log into TikTok in your browser
 *   2. Open DevTools → Application → Cookies → tiktok.com
 *   3. Copy the `sessionid` value
 *   4. Set it as the account's accessToken in the dashboard
 *   5. Optionally set metadata: {"tt_target_idc": "useast2a"}
 *
 * Environment variables:
 *   TIKTOK_HEADLESS  - "true" or "false" (default: "true")
 */
export class TikTokSessionPublisher implements PlatformPublisher {
  platform = "tiktok";

  async publishVideo(input: PublishInput): Promise<PublishResult> {
    const headless = process.env.TIKTOK_HEADLESS !== "false";

    // ── Validate inputs ──
    const videoPath = path.resolve(input.filePath);
    if (!fs.existsSync(videoPath)) {
      return this.fail(`Video file not found: ${input.filePath}`);
    }

    const fileStat = fs.statSync(videoPath);
    if (fileStat.size === 0) {
      return this.fail("Video file is empty");
    }

    const cookies = parseSessionCookies(input.accessToken, input.metadata);
    if (!cookies) {
      return this.fail(
        "TikTok session cookie not found. Set the sessionid as the account's accessToken. " +
          "Get it from your browser: DevTools → Application → Cookies → tiktok.com → sessionid"
      );
    }

    console.log(`[TikTokSession] Starting upload for account ${input.accountId}`);
    console.log(`[TikTokSession] Video: ${input.filePath} (${(fileStat.size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`[TikTokSession] Session ID: ${cookies.sessionId.substring(0, 8)}...`);
    console.log(`[TikTokSession] Datacenter: ${cookies.dcId}`);

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let currentStep = "init";

    try {
      // ── Launch browser ──
      currentStep = "launch-browser";
      console.log(`[TikTokSession] Launching Chromium (headless=${headless})`);

      browser = await chromium.launch({
        headless,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-infobars",
          "--window-size=1280,900",
          "--lang=en-US,en",
        ],
      });

      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
      });

      // Override navigator.webdriver to avoid bot detection
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      // ── Set session cookies ──
      currentStep = "set-cookies";
      console.log("[TikTokSession] Setting session cookies...");

      // Set the full set of session cookies TikTok expects
      const cookieBase = {
        domain: ".tiktok.com" as const,
        path: "/",
        secure: true,
        sameSite: "None" as const,
      };

      await context.addCookies([
        { ...cookieBase, name: "sessionid", value: cookies.sessionId, httpOnly: true },
        { ...cookieBase, name: "sessionid_ss", value: cookies.sessionId, httpOnly: true },
        { ...cookieBase, name: "sid_tt", value: cookies.sessionId, httpOnly: true },
        { ...cookieBase, name: "sid_guard", value: `${cookies.sessionId}|${Math.floor(Date.now() / 1000)}|5184000|${Math.floor(Date.now() / 1000) + 5184000}`, httpOnly: true },
        { ...cookieBase, name: "tt-target-idc", value: cookies.dcId, httpOnly: false },
        { ...cookieBase, name: "tt_csrf_token", value: this.generateCsrfToken(), httpOnly: false },
        { ...cookieBase, name: "tt-target-idc-sign", value: this.generateCsrfToken(), httpOnly: false },
        { ...cookieBase, name: "passport_csrf_token", value: this.generateCsrfToken(), httpOnly: false },
      ]);

      page = await context.newPage();

      // ── Navigate to upload page ──
      currentStep = "navigate-upload";
      console.log("[TikTokSession] Navigating to TikTok Creator Center...");

      // First visit TikTok homepage to let cookies take effect and get additional cookies from JS
      await page.goto("https://www.tiktok.com/", {
        waitUntil: "load",
        timeout: 30000,
      });
      await humanDelay(4000, 6000);
      await saveDebugScreenshot(page, "01-homepage");

      // Check if we're logged in by looking for upload/profile elements
      const loggedIn = await this.checkLoggedIn(page);
      if (!loggedIn) {
        await saveDebugScreenshot(page, "01b-not-logged-in");
        return this.fail(
          "TikTok session cookie is invalid or expired. " +
            "Please get a fresh sessionid from your browser and update the account."
        );
      }
      console.log("[TikTokSession] Session valid - user is logged in");

      // Navigate to the upload page by clicking the upload link first (more natural),
      // then fall back to direct navigation with multiple possible URLs.
      let onUploadPage = false;

      // Strategy 1: Click the upload link on the homepage (respects TikTok's routing)
      const uploadLinkSelectors = [
        'a[href*="/upload"]',
        'a[href*="/creator-center/upload"]',
        'a[href*="/tiktokstudio/upload"]',
        '[data-e2e="upload-icon"]',
      ];

      for (const selector of uploadLinkSelectors) {
        try {
          const link = await page.$(selector);
          if (link) {
            console.log(`[TikTokSession] Clicking upload link: ${selector}`);
            await link.click();
            await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
            await humanDelay(3000, 5000);
            const url = page.url();
            console.log(`[TikTokSession] After clicking upload: ${url}`);
            if (!url.includes("/login")) {
              onUploadPage = true;
              break;
            }
            // Redirected to login - go back and try next selector
            await page.goBack();
            await humanDelay(1000, 2000);
          }
        } catch {
          // Try next
        }
      }

      // Strategy 2: Direct URL navigation to various upload page paths
      if (!onUploadPage) {
        const uploadUrls = [
          "https://www.tiktok.com/tiktokstudio/upload",
          "https://www.tiktok.com/upload",
          "https://www.tiktok.com/creator-center/upload",
          "https://www.tiktok.com/creator#/upload/upload",
        ];

        for (const uploadUrl of uploadUrls) {
          try {
            console.log(`[TikTokSession] Trying direct navigation: ${uploadUrl}`);
            await page.goto(uploadUrl, { waitUntil: "load", timeout: 20000 });
            await humanDelay(3000, 5000);
            const url = page.url();
            console.log(`[TikTokSession] After navigation: ${url}`);
            if (!url.includes("/login")) {
              onUploadPage = true;
              break;
            }
          } catch (e) {
            console.log(`[TikTokSession] Failed to navigate to ${uploadUrl}: ${e}`);
          }
        }
      }

      await saveDebugScreenshot(page, "02-upload-page");

      const currentUrl = page.url();
      console.log(`[TikTokSession] Current URL: ${currentUrl}`);

      if (!onUploadPage || currentUrl.includes("/login")) {
        await saveDebugScreenshot(page, "02b-redirected-to-login");
        return this.fail(
          "Could not navigate to TikTok upload page. " +
            "The session cookie may not have full access. " +
            "Try providing more cookies from your browser (sid_tt, sessionid_ss)."
        );
      }

      // ── Dismiss any popups/overlays ──
      currentStep = "dismiss-popups";
      await this.dismissPopups(page);

      // ── Upload the video file ──
      currentStep = "upload-video";
      console.log(`[TikTokSession] Uploading video: ${path.basename(videoPath)}`);

      // Look for the file input on the upload page
      // TikTok's upload page uses an iframe with a file input
      const fileInputSelectors = [
        'input[type="file"][accept="video/*"]',
        'input[type="file"]',
        'iframe[src*="upload"]',
      ];

      let fileInput = null;
      for (const selector of fileInputSelectors) {
        try {
          fileInput = await page.waitForSelector(selector, { timeout: 10000, state: "attached" });
          if (fileInput) {
            console.log(`[TikTokSession] Found file input: ${selector}`);
            break;
          }
        } catch {
          // Try next selector
        }
      }

      if (!fileInput) {
        // Try finding within iframes
        const frames = page.frames();
        for (const frame of frames) {
          try {
            fileInput = await frame.waitForSelector('input[type="file"]', { timeout: 5000, state: "attached" });
            if (fileInput) {
              console.log("[TikTokSession] Found file input inside iframe");
              break;
            }
          } catch {
            // Try next frame
          }
        }
      }

      if (!fileInput) {
        await saveDebugScreenshot(page, "03-no-file-input");
        // Try alternative: use the drag-drop area
        console.log("[TikTokSession] No file input found, trying setInputFiles on page...");

        // Sometimes file inputs are hidden - try to find any and set files
        const inputs = await page.$$('input[type="file"]');
        if (inputs.length > 0) {
          await inputs[0].setInputFiles(videoPath);
          fileInput = inputs[0];
          console.log("[TikTokSession] Set files on hidden input");
        } else {
          return this.fail(
            "Could not find file upload input on TikTok upload page. The page layout may have changed."
          );
        }
      } else {
        await fileInput.setInputFiles(videoPath);
      }

      console.log("[TikTokSession] Video file selected, waiting for upload to process...");
      await humanDelay(3000, 5000);
      await saveDebugScreenshot(page, "04-video-selected");

      // ── Wait for video to finish uploading/processing ──
      currentStep = "wait-upload";
      await this.waitForVideoProcessing(page);
      await saveDebugScreenshot(page, "05-video-processed");

      // ── Fill in caption/title ──
      currentStep = "fill-caption";
      const caption = this.buildCaption(input.caption, input.hashtags);
      console.log(`[TikTokSession] Setting caption: ${caption.substring(0, 50)}...`);

      await this.fillCaption(page, caption);
      await humanDelay(1000, 2000);
      await saveDebugScreenshot(page, "06-caption-filled");

      // ── Click Post/Publish button ──
      currentStep = "publish";
      console.log("[TikTokSession] Clicking Post button...");

      const posted = await this.clickPostButton(page);
      if (!posted) {
        await saveDebugScreenshot(page, "07-post-failed");
        return this.fail("Could not click the Post button. The page layout may have changed.");
      }

      // ── Wait for publish confirmation ──
      currentStep = "wait-publish";
      console.log("[TikTokSession] Waiting for publish confirmation...");
      await humanDelay(5000, 8000);
      await saveDebugScreenshot(page, "08-post-submitted");

      // Check for success indicators
      const publishResult = await this.checkPublishResult(page);
      if (!publishResult.success) {
        await saveDebugScreenshot(page, "09-publish-error");
        return this.fail(publishResult.error || "Publish failed for unknown reason");
      }

      console.log("[TikTokSession] Video published successfully!");
      return {
        success: true,
        externalPostId: publishResult.videoId,
        externalUrl: publishResult.videoUrl,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TikTokSession] Error at step '${currentStep}': ${errorMsg}`);

      if (page) {
        await saveDebugScreenshot(page, `error-${currentStep}`);
      }

      return this.fail(`Error at '${currentStep}': ${errorMsg}`);
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }

  // ─── Private helpers ──────────────────────────────────────

  private fail(msg: string): PublishResult {
    console.error(`[TikTokSession] ${msg}`);
    return { success: false, errorMessage: msg };
  }

  private generateCsrfToken(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 32; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
  }

  private async checkLoggedIn(page: Page): Promise<boolean> {
    try {
      // Look for elements that only appear when logged in
      const loggedInSelectors = [
        '[data-e2e="upload-icon"]',
        'a[href*="/creator-center"]',
        '[data-e2e="profile-icon"]',
        'a[href*="/upload"]',
        '[class*="DivProfileContainer"]',
        // Avatar or user menu
        '[data-e2e="nav-user-avatar"]',
      ];

      for (const selector of loggedInSelectors) {
        const el = await page.$(selector);
        if (el) {
          console.log(`[TikTokSession] Logged-in indicator found: ${selector}`);
          return true;
        }
      }

      // Check the page content for login prompts
      const pageContent = await page.content();
      if (
        pageContent.includes("Log in to TikTok") ||
        pageContent.includes("login-modal") ||
        page.url().includes("/login")
      ) {
        return false;
      }

      // If we're on tiktok.com and not redirected to login, assume logged in
      if (page.url().includes("tiktok.com") && !page.url().includes("/login")) {
        console.log("[TikTokSession] On TikTok without login redirect - assuming logged in");
        return true;
      }

      return false;
    } catch (err) {
      console.warn(`[TikTokSession] Login check error: ${err}`);
      return false;
    }
  }

  private async dismissPopups(page: Page): Promise<void> {
    // Dismiss cookie consent banners
    const cookieSelectors = [
      'button:has-text("Accept all")',
      'button:has-text("Accept All")',
      'button:has-text("Allow all cookies")',
      '[data-e2e="cookie-banner-accept"]',
    ];

    for (const selector of cookieSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          await humanDelay(500, 1000);
          console.log("[TikTokSession] Dismissed cookie banner");
          break;
        }
      } catch {
        // Continue
      }
    }

    // Dismiss any other modals
    const closeSelectors = [
      '[aria-label="Close"]',
      'button[class*="CloseButton"]',
      '[data-e2e="modal-close-button"]',
    ];

    for (const selector of closeSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          await humanDelay(300, 600);
          console.log(`[TikTokSession] Dismissed popup via: ${selector}`);
        }
      } catch {
        // Continue
      }
    }
  }

  private async waitForVideoProcessing(page: Page): Promise<void> {
    // Wait for upload progress to complete
    // TikTok shows a progress bar and "Uploaded" or percentage indicator
    const maxWaitMs = 300000; // 5 minutes max
    const pollIntervalMs = 3000;
    const startTime = Date.now();

    console.log("[TikTokSession] Waiting for video upload to complete (max 5 min)...");

    while (Date.now() - startTime < maxWaitMs) {
      // Check for completion indicators
      const completionIndicators = [
        // Caption/description input appearing means upload is done
        '[data-e2e="post-button"]',
        'button:has-text("Post")',
        'button:has-text("Publish")',
        // Editor interface appearing
        '[class*="DivEditorContainer"]',
        '[data-e2e="caption-input"]',
        // Progress complete
        '[class*="success"]',
        '[class*="completed"]',
      ];

      for (const selector of completionIndicators) {
        try {
          const el = await page.$(selector);
          if (el && (await el.isVisible())) {
            console.log(`[TikTokSession] Upload completed - detected: ${selector}`);
            return;
          }
        } catch {
          // Continue
        }
      }

      // Check for error messages
      const errorIndicators = [
        '[class*="error"]:visible',
        '[data-e2e="upload-error"]',
        'text="Upload failed"',
        'text="Something went wrong"',
      ];

      for (const selector of errorIndicators) {
        try {
          const el = await page.$(selector);
          if (el && (await el.isVisible())) {
            const text = await el.textContent();
            throw new Error(`Upload error: ${text || "Unknown error"}`);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Upload error:")) throw e;
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    console.warn("[TikTokSession] Upload wait timed out after 5 minutes - proceeding anyway");
  }

  private buildCaption(caption?: string, hashtags?: string): string {
    let text = caption || "";
    if (hashtags) {
      const tags = hashtags
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`))
        .join(" ");
      text = text ? `${text} ${tags}` : tags;
    }
    // TikTok caption limit is 2200 characters
    return text.substring(0, 2200);
  }

  private async fillCaption(page: Page, caption: string): Promise<void> {
    // TikTok uses a contenteditable div for the caption
    const captionSelectors = [
      '[data-e2e="caption-input"]',
      '[contenteditable="true"]',
      'div[class*="DivEditorContainer"] [contenteditable]',
      'div[class*="caption"] [contenteditable]',
      // Fallback: any editable area
      '[role="textbox"]',
      '.public-DraftEditor-content',
    ];

    for (const selector of captionSelectors) {
      try {
        const el = await page.$(selector);
        if (el && (await el.isVisible())) {
          // Clear existing text first
          await el.click();
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
          await humanDelay(300, 600);

          // Type the caption
          await page.keyboard.type(caption, { delay: 20 + Math.random() * 30 });
          console.log(`[TikTokSession] Caption filled via: ${selector}`);
          return;
        }
      } catch {
        // Try next selector
      }
    }

    console.warn("[TikTokSession] Could not find caption input - proceeding without caption");
  }

  private async clickPostButton(page: Page): Promise<boolean> {
    const postSelectors = [
      '[data-e2e="post-button"]',
      'button:has-text("Post")',
      'button:has-text("Publish")',
      'button:has-text("Upload")',
      // Try different TikTok Creator Center button patterns
      'div[class*="DivButton"]:has-text("Post")',
      'button[class*="Button"]:has-text("Post")',
    ];

    for (const selector of postSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          const isDisabled = await btn.getAttribute("disabled");
          if (isDisabled !== null) {
            console.log(`[TikTokSession] Post button found but disabled: ${selector}`);
            continue;
          }
          await btn.click();
          console.log(`[TikTokSession] Clicked post button: ${selector}`);
          return true;
        }
      } catch {
        // Try next selector
      }
    }

    // Last resort: try clicking by position
    try {
      const buttons = await page.$$("button");
      for (const btn of buttons) {
        const text = await btn.textContent();
        if (text && /^(post|publish|upload)$/i.test(text.trim())) {
          await btn.click();
          console.log(`[TikTokSession] Clicked button by text: "${text.trim()}"`);
          return true;
        }
      }
    } catch {
      // Fall through
    }

    return false;
  }

  private async checkPublishResult(
    page: Page
  ): Promise<{ success: boolean; videoId?: string; videoUrl?: string; error?: string }> {
    // Wait for result - check for success or error over 30 seconds
    const maxWaitMs = 30000;
    const pollInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      // Check for success indicators
      const successIndicators = [
        'text="Your video has been uploaded"',
        'text="Your video is being uploaded"',
        'text="Video published"',
        '[class*="success"]',
        // Redirect to manage page or video page
      ];

      for (const selector of successIndicators) {
        try {
          const el = await page.$(selector);
          if (el) {
            console.log(`[TikTokSession] Success indicator found: ${selector}`);
            return { success: true };
          }
        } catch {
          // Continue
        }
      }

      // Check current URL for redirect to video page
      const url = page.url();
      if (url.includes("/video/") || url.includes("/manage/uploads")) {
        // Try to extract video ID from URL
        const videoIdMatch = url.match(/\/video\/(\d+)/);
        const videoId = videoIdMatch?.[1];
        return {
          success: true,
          videoId,
          videoUrl: videoId ? `https://www.tiktok.com/@user/video/${videoId}` : undefined,
        };
      }

      // Check for error indicators
      const pageContent = await page.content();
      if (
        pageContent.includes("failed") ||
        pageContent.includes("error") ||
        pageContent.includes("try again")
      ) {
        // Check if it's a real error message
        const errorEls = await page.$$('[class*="error"], [class*="Error"]');
        for (const el of errorEls) {
          const text = await el.textContent();
          if (text && text.length > 5 && text.length < 200) {
            return { success: false, error: `TikTok error: ${text}` };
          }
        }
      }

      // If we see the upload page content has changed significantly (post was submitted)
      // Accept it as success after a reasonable wait
      if (Date.now() - startTime > 15000) {
        // Check if the Post button is gone (indicating submission)
        const postBtn = await page.$('[data-e2e="post-button"]');
        if (!postBtn) {
          console.log("[TikTokSession] Post button no longer visible - assuming success");
          return { success: true };
        }
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Timeout - check final state
    console.warn("[TikTokSession] Publish result check timed out");

    // If we're still on the upload page, it probably failed
    if (page.url().includes("/upload")) {
      return { success: false, error: "Publish timed out - still on upload page" };
    }

    // Otherwise assume success (page may have navigated)
    return { success: true };
  }
}
