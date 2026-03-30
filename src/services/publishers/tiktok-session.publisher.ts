import { chromium, Browser, BrowserContext, Page } from "playwright";
import { PlatformPublisher, PublishInput, PublishResult } from "./types";
import prisma from "@/lib/prisma";
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
    await page.screenshot({ path: filepath, fullPage: false, timeout: 10000 });
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
    const hasCredentials = !!(input.metadata?.tiktokEmail && input.metadata?.tiktokPassword);
    if (!cookies && !hasCredentials) {
      return this.fail(
        "TikTok session cookie not found and no login credentials configured. " +
          "Set tiktokEmail/tiktokPassword in account metadata, or provide a sessionid."
      );
    }

    console.log(`[TikTokSession] Starting upload for account ${input.accountId}`);
    console.log(`[TikTokSession] Video: ${input.filePath} (${(fileStat.size / 1024 / 1024).toFixed(1)} MB)`);
    if (cookies) {
      console.log(`[TikTokSession] Session ID: ${cookies.sessionId.substring(0, 8)}...`);
      console.log(`[TikTokSession] Datacenter: ${cookies.dcId}`);
    } else {
      console.log("[TikTokSession] No session cookie — will try credential login");
    }

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
          // Memory optimization flags for constrained environments
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--disable-translate",
          "--no-first-run",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--js-flags=--max-old-space-size=256",
          "--single-process",
        ],
      });

      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1024, height: 768 },
        locale: "en-US",
      });

      // Override navigator.webdriver to avoid bot detection
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      // Block heavy resources to save memory (images, fonts, media previews)
      await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf}", (route) =>
        route.abort()
      );
      await context.route("**/analytics/**", (route) => route.abort());
      await context.route("**/sentry/**", (route) => route.abort());

      // ── Set session cookies (if available) ──
      currentStep = "set-cookies";
      if (cookies) {
        console.log("[TikTokSession] Setting session cookies...");

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
      }

      page = await context.newPage();

      // ── Navigate to upload page ──
      currentStep = "navigate-upload";
      console.log("[TikTokSession] Navigating to TikTok Creator Center...");

      // First visit TikTok homepage to let cookies take effect and get additional cookies from JS
      await page.goto("https://www.tiktok.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await humanDelay(4000, 6000);
      await saveDebugScreenshot(page, "01-homepage");

      // Check if we're logged in by looking for upload/profile elements
      let loggedIn = await this.checkLoggedIn(page);
      if (!loggedIn) {
        await saveDebugScreenshot(page, "01b-not-logged-in");

        // Try auto-login with email/password if credentials are available
        const email = input.metadata?.tiktokEmail as string | undefined;
        const password = input.metadata?.tiktokPassword as string | undefined;
        if (email && password) {
          console.log("[TikTokSession] Session expired — attempting auto-login with credentials...");
          const loginOk = await this.loginWithCredentials(page, context, email, password);
          if (loginOk) {
            // Extract the fresh sessionid from browser cookies and persist it
            const newSessionId = await this.extractSessionId(context);
            if (newSessionId) {
              await this.saveSessionToDb(input.accountId, newSessionId);
            }
            loggedIn = true;
          }
        }

        if (!loggedIn) {
          return this.fail(
            "TikTok session ID geçersiz veya süresi dolmuş. " +
              "Chrome'da tiktok.com'a giriş yap → F12 → Application → Cookies → sessionid değerini kopyala → " +
              "Dashboard'da hesabı düzenleyerek yeni session ID'yi gir."
          );
        }
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
            await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
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
            await page.goto(uploadUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
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

      // ── Dismiss overlays that appeared after upload ──
      currentStep = "dismiss-post-upload-popups";
      await this.dismissPopups(page);
      await this.dismissJoyrideOverlay(page);
      await humanDelay(500, 1000);

      // ── Fill in caption/title ──
      currentStep = "fill-caption";
      const caption = this.buildCaption(input.caption, input.hashtags);
      console.log(`[TikTokSession] Setting caption: ${caption.substring(0, 50)}...`);

      await this.fillCaption(page, caption);
      await humanDelay(1000, 2000);
      await saveDebugScreenshot(page, "06-caption-filled");

      // ── Dismiss any last popups before clicking Post ──
      currentStep = "dismiss-popups-pre-post";
      await this.dismissPopups(page);
      await this.dismissJoyrideOverlay(page);
      await humanDelay(500, 1000);

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

  // ─── Auto-login helpers ─────────────────────────────────

  private async loginWithCredentials(
    page: Page,
    context: BrowserContext,
    email: string,
    password: string
  ): Promise<boolean> {
    try {
      console.log("[TikTokSession] Navigating to TikTok login page...");
      await page.goto("https://www.tiktok.com/login/phone-or-email/email", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await humanDelay(3000, 5000);
      await this.dismissPopups(page);

      // Fill email
      const emailInput = page.locator('input[name="username"], input[type="text"][placeholder*="email" i], input[type="text"][placeholder*="Email" i], input[type="text"][placeholder*="phone" i]').first();
      if ((await emailInput.count()) === 0) {
        console.warn("[TikTokSession] Could not find email input on login page");
        await saveDebugScreenshot(page, "login-no-email-input");
        return false;
      }
      await emailInput.click();
      await humanDelay(300, 600);
      await emailInput.fill(email);
      await humanDelay(500, 1000);

      // Fill password
      const passwordInput = page.locator('input[type="password"]').first();
      if ((await passwordInput.count()) === 0) {
        console.warn("[TikTokSession] Could not find password input on login page");
        await saveDebugScreenshot(page, "login-no-password-input");
        return false;
      }
      await passwordInput.click();
      await humanDelay(300, 600);
      await passwordInput.fill(password);
      await humanDelay(500, 1000);

      await saveDebugScreenshot(page, "login-credentials-filled");

      // Click login button
      const loginBtn = page.locator('button[type="submit"], button:text-is("Log in")').first();
      await loginBtn.click();
      console.log("[TikTokSession] Clicked login button, waiting for navigation...");

      // Wait for navigation or CAPTCHA/2FA (up to 60 seconds)
      // TikTok may show a puzzle CAPTCHA here — in non-headless mode the user can solve it
      const maxLoginWaitMs = 60000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxLoginWaitMs) {
        await humanDelay(3000, 5000);
        const url = page.url();

        // Successfully logged in — redirected away from login page
        if (!url.includes("/login")) {
          console.log(`[TikTokSession] Login successful! Redirected to: ${url}`);
          await saveDebugScreenshot(page, "login-success");
          return true;
        }

        // Check for error messages
        const errorText = await page
          .locator('[class*="error" i], [class*="Error"]')
          .first()
          .textContent()
          .catch(() => null);
        if (errorText && errorText.length > 5 && (errorText.toLowerCase().includes("incorrect") || errorText.toLowerCase().includes("wrong"))) {
          console.error(`[TikTokSession] Login error: ${errorText.trim()}`);
          await saveDebugScreenshot(page, "login-error");
          return false;
        }

        // Still on login page — likely CAPTCHA or verification
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`[TikTokSession] Waiting for login (${elapsed}s) — CAPTCHA/verification may be required...`);
      }

      console.warn("[TikTokSession] Login timed out after 60s");
      await saveDebugScreenshot(page, "login-timeout");
      return false;
    } catch (err) {
      console.error(`[TikTokSession] Login error: ${err}`);
      await saveDebugScreenshot(page, "login-exception");
      return false;
    }
  }

  private async extractSessionId(context: BrowserContext): Promise<string | null> {
    try {
      const cookies = await context.cookies("https://www.tiktok.com");
      const sessionCookie = cookies.find((c) => c.name === "sessionid");
      if (sessionCookie?.value) {
        console.log(`[TikTokSession] Extracted new sessionid: ${sessionCookie.value.substring(0, 12)}...`);
        return sessionCookie.value;
      }
    } catch (err) {
      console.warn(`[TikTokSession] Failed to extract sessionid: ${err}`);
    }
    return null;
  }

  private async saveSessionToDb(accountId: string, newSessionId: string): Promise<void> {
    try {
      const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
      if (!account) return;

      const metadata = JSON.parse(account.metadata || "{}");
      metadata.sessionid = newSessionId;

      await prisma.socialAccount.update({
        where: { id: accountId },
        data: {
          accessToken: newSessionId,
          metadata: JSON.stringify(metadata),
        },
      });
      console.log(`[TikTokSession] Saved new sessionid to DB for account ${accountId}`);
    } catch (err) {
      console.warn(`[TikTokSession] Failed to save sessionid to DB: ${err}`);
    }
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
      'button:has-text("Allow all")',
      'button:has-text("Accept all")',
      'button:has-text("Accept All")',
      'button:has-text("Allow all cookies")',
      'button:has-text("Decline optional cookies")',
      '[data-e2e="cookie-banner-accept"]',
    ];

    for (const selector of cookieSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          await humanDelay(500, 1000);
          console.log(`[TikTokSession] Dismissed cookie banner via: ${selector}`);
          break;
        }
      } catch {
        // Continue
      }
    }

    // Dismiss "Turn on automatic content checks?" modal - cancel it
    // NOTE: only dismiss if the dedicated "Turn on" / "Cancel" belong to this modal,
    // NOT the "Continue to post?" modal (that one is handled separately via handleContinueToPostModal)
    try {
      const pageContent = await page.content();
      const hasTurnOn = await page.$('button:text-is("Turn on")');
      if (hasTurnOn && (await hasTurnOn.isVisible().catch(() => false)) &&
          (pageContent.includes("automatic content checks") || pageContent.includes("Turn on automatic"))) {
        await hasTurnOn.click();
        await humanDelay(500, 1000);
        console.log("[TikTokSession] Dismissed content checks modal via: Turn on");
      }
    } catch {
      // Continue
    }

    // Dismiss "New editing features added" / "Got it" popup
    try {
      const gotItBtn = await page.$('button:has-text("Got it")');
      if (gotItBtn && (await gotItBtn.isVisible())) {
        await gotItBtn.click();
        await humanDelay(500, 1000);
        console.log("[TikTokSession] Dismissed 'Got it' popup");
      }
    } catch {
      // Continue
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

  private async dismissJoyrideOverlay(page: Page): Promise<void> {
    // Dismiss react-joyride tutorial overlay that blocks all interactions
    try {
      const joyrideOverlay = await page.$('[data-test-id="overlay"], .react-joyride__overlay');
      if (joyrideOverlay) {
        // Click "Got it" or any joyride close button
        const joyrideButtons = [
          'button:has-text("Got it")',
          'button:has-text("Skip")',
          'button:has-text("Next")',
          'button:has-text("Close")',
          '[data-test-id="button-primary"]',
        ];

        for (const selector of joyrideButtons) {
          const btn = await page.$(selector);
          if (btn && (await btn.isVisible().catch(() => false))) {
            await btn.click({ force: true });
            await humanDelay(500, 1000);
            console.log(`[TikTokSession] Dismissed joyride overlay via: ${selector}`);
            return;
          }
        }

        // If no button found, try to remove the overlay via JS
        await page.evaluate(() => {
          const portal = document.getElementById("react-joyride-portal");
          if (portal) portal.remove();
          const overlays = document.querySelectorAll(".react-joyride__overlay, [data-test-id='overlay']");
          overlays.forEach((el) => el.remove());
        });
        console.log("[TikTokSession] Removed joyride overlay via JS");
      }
    } catch (err) {
      console.log(`[TikTokSession] Joyride dismissal: ${err}`);
    }
  }

  private async waitForVideoProcessing(page: Page): Promise<void> {
    // Wait for upload progress to complete
    // TikTok shows a progress bar; once complete, the Post button becomes enabled
    const maxWaitMs = 300000; // 5 minutes max
    const pollIntervalMs = 5000;
    const startTime = Date.now();

    console.log("[TikTokSession] Waiting for video upload to complete (max 5 min)...");

    let postButtonSeen = false;

    while (Date.now() - startTime < maxWaitMs) {
      // Check for the Post button specifically - TikTok Studio shows it once upload completes
      const postBtnSelectors = [
        'button:text-is("Post")',
        'button:text-is("Publish")',
        'div[role="button"]:text-is("Post")',
        '[data-e2e="post-button"]',
      ];

      for (const selector of postBtnSelectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            const visible = await el.isVisible().catch(() => false);
            const disabled = await el.isDisabled().catch(() => false);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`[TikTokSession] Post button: visible=${visible} disabled=${disabled} (${elapsed}s)`);

            if (visible && !disabled) {
              console.log(`[TikTokSession] Upload completed - Post button is ready: ${selector}`);
              return;
            }
            postButtonSeen = true;
          }
        } catch {
          // Continue
        }
      }

      // Also check for editor/caption area as an indicator
      if (!postButtonSeen) {
        const completionIndicators = [
          '[class*="DivEditorContainer"]',
          '[data-e2e="caption-input"]',
          '[contenteditable="true"]',
          '[role="textbox"]',
        ];

        for (const selector of completionIndicators) {
          try {
            const el = await page.$(selector);
            if (el && (await el.isVisible().catch(() => false))) {
              console.log(`[TikTokSession] Upload completed - detected: ${selector}`);
              return;
            }
          } catch {
            // Continue
          }
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
    // TikTok Studio uses a contenteditable div for the caption/description.
    // Even if caption is empty, we need to clear the auto-filled filename.
    const captionSelectors = [
      '[data-e2e="caption-input"]',
      // TikTok Studio's editor area - the contenteditable near the description label
      'div[class*="editor"] [contenteditable="true"]',
      'div[class*="caption"] [contenteditable="true"]',
      'div[class*="DivEditorContainer"] [contenteditable]',
      '[contenteditable="true"]',
      // Fallback: any editable area
      '[role="textbox"]',
      '.public-DraftEditor-content',
      // More generic approach - find by structure near the "Description" label
      'div.notranslate[contenteditable="true"]',
    ];

    for (const selector of captionSelectors) {
      try {
        const el = await page.$(selector);
        if (el && (await el.isVisible())) {
          // Clear existing text first (removes the auto-filled UUID filename)
          await el.click();
          await humanDelay(300, 500);
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
          await humanDelay(300, 600);

          // Type the caption if provided
          if (caption) {
            await page.keyboard.type(caption, { delay: 20 + Math.random() * 30 });
          }
          console.log(`[TikTokSession] Caption ${caption ? "filled" : "cleared (auto-filename removed)"} via: ${selector}`);
          return;
        }
      } catch (err) {
        console.log(`[TikTokSession] Caption selector ${selector} failed: ${err}`);
      }
    }

    // Last resort: try to find any element showing the UUID-like filename and clear it
    try {
      const editables = await page.$$('[contenteditable="true"]');
      console.log(`[TikTokSession] Found ${editables.length} contenteditable elements`);
      for (const el of editables) {
        const text = await el.textContent();
        console.log(`[TikTokSession]   Editable content: "${text?.substring(0, 60)}"`);
        // If it contains a UUID-like pattern (our stored filename), clear it
        if (text && /[0-9a-f]{8}-[0-9a-f]{4}/.test(text)) {
          await el.click();
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
          await humanDelay(300, 600);
          if (caption) {
            await page.keyboard.type(caption, { delay: 20 + Math.random() * 30 });
          }
          console.log(`[TikTokSession] Cleared UUID filename from editable and ${caption ? "set caption" : "left empty"}`);
          return;
        }
      }
    } catch (err) {
      console.log(`[TikTokSession] Last resort caption clear failed: ${err}`);
    }

    console.warn("[TikTokSession] Could not find caption input - proceeding without caption");
  }

  private async clickPostButton(page: Page): Promise<boolean> {
    // First, log all visible buttons on the page for debugging
    try {
      const allButtons = await page.$$("button");
      console.log(`[TikTokSession] Found ${allButtons.length} buttons on page`);
      for (const btn of allButtons) {
        const text = (await btn.textContent())?.trim().substring(0, 50) || "";
        const visible = await btn.isVisible().catch(() => false);
        const disabled = await btn.isDisabled().catch(() => false);
        if (text) {
          console.log(`[TikTokSession]   Button: "${text}" visible=${visible} disabled=${disabled}`);
        }
      }
    } catch (e) {
      console.log(`[TikTokSession] Could not enumerate buttons: ${e}`);
    }

    // Also check for div-based buttons (TikTok Studio uses these)
    try {
      const divButtons = await page.$$('div[role="button"]');
      console.log(`[TikTokSession] Found ${divButtons.length} div[role=button] on page`);
      for (const btn of divButtons) {
        const text = (await btn.textContent())?.trim().substring(0, 50) || "";
        const visible = await btn.isVisible().catch(() => false);
        if (text) {
          console.log(`[TikTokSession]   DivButton: "${text}" visible=${visible}`);
        }
      }
    } catch (e) {
      console.log(`[TikTokSession] Could not enumerate div buttons: ${e}`);
    }

    const postSelectors = [
      '[data-e2e="post-button"]',
      // Use :text-is() for EXACT text match (not :has-text which also matches "Posts")
      'button:text-is("Post")',
      'button:text-is("Publish")',
      // TikTok Studio uses div-based buttons
      'div[role="button"]:text-is("Post")',
      'div[role="button"]:text-is("Publish")',
      'div[class*="DivButton"]:text-is("Post")',
      'button[class*="Button"]:text-is("Post")',
      // Broader matches
      '*[class*="post-button"]',
      '*[class*="PostButton"]',
      '*[class*="btn-post"]',
    ];

    for (const selector of postSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          const visible = await btn.isVisible().catch(() => true);
          if (!visible) {
            console.log(`[TikTokSession] Post button found but not visible: ${selector}`);
            continue;
          }
          const disabled = await btn.isDisabled().catch(() => false);
          if (disabled) {
            console.log(`[TikTokSession] Post button found but disabled: ${selector}`);
            // Wait up to 30s for it to become enabled
            try {
              await page.waitForSelector(`${selector}:not([disabled])`, { timeout: 30000 });
              console.log(`[TikTokSession] Post button became enabled: ${selector}`);
            } catch {
              console.log(`[TikTokSession] Post button still disabled after 30s: ${selector}`);
              continue;
            }
          }
          await btn.click({ force: true });
          console.log(`[TikTokSession] Clicked post button: ${selector}`);
          return true;
        }
      } catch (e) {
        console.log(`[TikTokSession] Error trying selector ${selector}: ${e}`);
      }
    }

    // Last resort: try clicking any button/div with Post/Publish text
    try {
      const allClickable = await page.$$("button, div[role='button'], a[role='button']");
      for (const btn of allClickable) {
        const text = await btn.textContent();
        if (text && /^(post|publish)$/i.test(text.trim())) {
          await btn.click({ force: true });
          console.log(`[TikTokSession] Clicked element by text: "${text.trim()}"`);
          return true;
        }
      }
    } catch {
      // Fall through
    }

    return false;
  }

  private async handleContinueToPostModal(page: Page): Promise<boolean> {
    // "Continue to post?" appears when content checks are still running after clicking Post.
    // We must click "Post now" (NOT Cancel) to actually submit the video.
    // Returns true if the modal was found and "Post now" was clicked.
    try {
      // Use locator() for reliable text matching (handles div[role=button] too)
      const postNowBtn = page.locator('button, [role="button"]').filter({ hasText: /^Post now$/i }).first();
      if ((await postNowBtn.count()) > 0 && (await postNowBtn.isVisible().catch(() => false))) {
        await postNowBtn.click({ force: true });
        await humanDelay(2000, 3000);
        console.log("[TikTokSession] Clicked 'Post now' on 'Continue to post?' modal");
        return true;
      }
    } catch (err) {
      console.log(`[TikTokSession] handleContinueToPostModal: ${err}`);
    }
    return false;
  }

  private async checkPublishResult(
    page: Page
  ): Promise<{ success: boolean; videoId?: string; videoUrl?: string; error?: string }> {
    // Wait for result - check for success or error over 60 seconds
    const maxWaitMs = 60000;
    const pollInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      // Handle "Continue to post?" confirmation modal - click "Post now" first
      // If clicked, skip all success checks this iteration (avoid false positive from Post/Discard
      // buttons being hidden behind the modal overlay while we wait for TikTok to actually post)
      const continueModalClicked = await this.handleContinueToPostModal(page).catch(() => false);
      if (continueModalClicked) {
        await new Promise((r) => setTimeout(r, pollInterval));
        continue;
      }

      // Dismiss other popups (cookie banners etc)
      await this.dismissPopups(page).catch(() => {});

      // Check current URL for redirect away from upload page
      const url = page.url();

      // Check for redirect to video page or manage page (strongest success signal)
      if (url.includes("/video/") || url.includes("/manage/uploads") || url.includes("/tiktokstudio/content")) {
        const videoIdMatch = url.match(/\/video\/(\d+)/);
        const videoId = videoIdMatch?.[1];
        console.log(`[TikTokSession] Redirected to: ${url}`);
        return {
          success: true,
          videoId,
          videoUrl: videoId ? `https://www.tiktok.com/@user/video/${videoId}` : undefined,
        };
      }

      // Check for the actual post-success elements (NOT upload success)
      // TikTok shows "Your video has been uploaded" or "Manage your posts" after posting
      const successTexts = [
        'text="Your video has been uploaded"',
        'text="Your video is being uploaded"',
        'text="Video published"',
        'text="Manage your posts"',
        'text="Upload another video"',
      ];

      for (const selector of successTexts) {
        try {
          const el = await page.$(selector);
          if (el && (await el.isVisible().catch(() => false))) {
            console.log(`[TikTokSession] Success text found: ${selector}`);
            return { success: true };
          }
        } catch {
          // Continue
        }
      }

      // Check for success class BUT only if the Post/Discard buttons are gone
      // (otherwise [class*="success"] matches the upload progress indicator)
      try {
        const successEl = await page.$('[class*="success"]');
        if (successEl && (await successEl.isVisible().catch(() => false))) {
          const postBtn = await page.$('button:text-is("Post")');
          const discardBtn = await page.$('button:text-is("Discard")');
          const postGone = !postBtn || !(await postBtn.isVisible().catch(() => false));
          const discardGone = !discardBtn || !(await discardBtn.isVisible().catch(() => false));
          if (postGone && discardGone) {
            // Guard: if "Continue to post?" modal is visible, it's a false positive
            // (Post/Discard are hidden behind the modal overlay but video isn't posted yet)
            const postNowVisible = await page
              .locator('button, [role="button"]')
              .filter({ hasText: /^Post now$/i })
              .first()
              .isVisible()
              .catch(() => false);
            if (postNowVisible) {
              console.log("[TikTokSession] False success guard: 'Continue to post?' modal still visible, clicking Post now");
              await page.locator('button, [role="button"]').filter({ hasText: /^Post now$/i }).first().click({ force: true }).catch(() => {});
              await new Promise((r) => setTimeout(r, pollInterval));
              continue;
            }
            console.log("[TikTokSession] Success indicator found and Post/Discard buttons gone");
            return { success: true };
          } else {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`[TikTokSession] Success class visible but Post/Discard still present (${elapsed}s) - waiting...`);
          }
        }
      } catch {
        // Continue
      }

      // Check for error messages on the upload form
      try {
        const errorEls = await page.$$('[class*="error"]:not([class*="success"]), [class*="Error"]:not([class*="Success"])');
        for (const el of errorEls) {
          if (await el.isVisible().catch(() => false)) {
            const text = await el.textContent();
            if (text && text.length > 5 && text.length < 200 && !text.includes("optional")) {
              return { success: false, error: `TikTok error: ${text.trim()}` };
            }
          }
        }
      } catch {
        // Continue
      }

      // After 30s, check if Post button is gone
      if (Date.now() - startTime > 30000) {
        const postBtn = await page.$('button:text-is("Post")');
        const postVisible = postBtn ? await postBtn.isVisible().catch(() => false) : false;
        if (!postVisible) {
          console.log("[TikTokSession] Post button no longer visible after 30s - assuming success");
          return { success: true };
        }
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Timeout - check final state
    console.warn("[TikTokSession] Publish result check timed out after 60s");

    // If we're still on the upload page with Post button visible, it failed
    const postBtn = await page.$('button:text-is("Post")');
    const stillHasPost = postBtn ? await postBtn.isVisible().catch(() => false) : false;
    if (page.url().includes("/upload") && stillHasPost) {
      return { success: false, error: "Publish timed out - Post button still visible on upload page" };
    }

    // Otherwise assume success (page may have navigated or button gone)
    return { success: true };
  }
}
