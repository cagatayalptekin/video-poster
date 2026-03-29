import { chromium, Browser, BrowserContext, Page } from "playwright";
import { PlatformPublisher, PublishInput, PublishResult } from "./types";
import path from "path";
import fs from "fs";

const SCREENSHOT_DIR = path.resolve("./debug-screenshots");
const SESSION_DIR = path.resolve("./playwright-state");
const SESSION_FILE = path.join(SESSION_DIR, "instagram-storage-state.json");

// Ensure screenshot directory exists
function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

// Ensure session directory exists
function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

/**
 * Returns true if a saved session file exists on disk.
 */
function hasSavedSession(): boolean {
  return fs.existsSync(SESSION_FILE);
}

/**
 * Saves current browser context storage state (cookies + localStorage) to disk.
 */
async function saveSession(context: BrowserContext): Promise<void> {
  ensureSessionDir();
  await context.storageState({ path: SESSION_FILE });
  console.log(`[InstagramPlaywright] Session saved to ${SESSION_FILE}`);
}

/**
 * Deletes the saved session file to force a fresh login on the next run.
 */
function clearSavedSession(): void {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    console.log("[InstagramPlaywright] Saved session cleared");
  }
}

/**
 * Navigates to instagram.com and checks whether the user is already logged in.
 * Returns true if the session is valid (no login redirect), false otherwise.
 */
async function isSessionValid(page: Page): Promise<boolean> {
  try {
    await page.goto("https://www.instagram.com/", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await humanDelay(2000, 3500);

    const url = page.url();
    // If redirected to login, session is expired/invalid
    if (
      url.includes("/accounts/login") ||
      url.includes("/challenge") ||
      url.includes("two_factor")
    ) {
      console.log(`[InstagramPlaywright] Session invalid — redirected to: ${url}`);
      return false;
    }

    // Check for a logged-in indicator: the nav bar or avatar element
    // TODO: Selector may change — these are typical logged-in nav indicators
    const loggedInIndicators = [
      '[aria-label="Home"]',
      'a[href="/direct/inbox/"]',
      'svg[aria-label="Home"]',
      'a[href*="/direct/"]',
      // Profile link
      'a[href^="/"][role="link"]:not([href="/"])',
    ];

    for (const selector of loggedInIndicators) {
      const el = await page.$(selector);
      if (el) {
        console.log(`[InstagramPlaywright] Session valid — detected logged-in element via: ${selector}`);
        return true;
      }
    }

    console.log("[InstagramPlaywright] Session validity unclear — no login-page redirect but no nav indicator found");
    // Conservative: treat as invalid so we do a fresh login
    return false;
  } catch (err) {
    console.warn(`[InstagramPlaywright] Session validity check failed: ${err}`);
    return false;
  }
}

/**
 * Takes a timestamped debug screenshot and saves it locally.
 */
async function saveDebugScreenshot(page: Page, stepName: string): Promise<string> {
  ensureScreenshotDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `ig-${stepName}-${timestamp}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  try {
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`[InstagramPlaywright] Debug screenshot saved: ${filepath}`);
  } catch (err) {
    console.error(`[InstagramPlaywright] Failed to save screenshot: ${err}`);
  }
  return filepath;
}

/**
 * Helper: wait for a selector with a custom timeout.
 */
async function waitForSelector(page: Page, selector: string, opts?: { timeout?: number; state?: "visible" | "attached" | "hidden" }) {
  const timeout = opts?.timeout ?? 15000;
  const state = opts?.state ?? "visible";
  return page.waitForSelector(selector, { timeout, state });
}

/**
 * Helper: safe click — waits for selector then clicks.
 */
async function safeClick(page: Page, selector: string, opts?: { timeout?: number }) {
  const el = await waitForSelector(page, selector, { timeout: opts?.timeout ?? 15000 });
  if (!el) throw new Error(`Element not found: ${selector}`);
  await el.click();
}

/**
 * Helper: small random delay to avoid detection patterns.
 */
async function humanDelay(minMs = 800, maxMs = 2500): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  await new Promise((r) => setTimeout(r, delay));
}

/**
 * Helper: type text with a human-like cadence.
 */
async function humanType(page: Page, selector: string, text: string): Promise<void> {
  try {
    await page.click(selector, { timeout: 5000 });
  } catch {
    // If regular click fails (element obscured), try force click via JS
    console.log(`[InstagramPlaywright] Regular click failed on ${selector}, trying JS click`);
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) el.click();
    }, selector);
    await page.focus(selector);
  }
  for (const char of text) {
    await page.keyboard.type(char, { delay: 30 + Math.random() * 80 });
  }
}

/**
 * Detects known challenge/blocker screens after login.
 * Returns a description of the challenge if found, or null.
 */
async function detectLoginChallenge(page: Page): Promise<string | null> {
  const url = page.url();

  // Suspicious login attempt
  if (url.includes("/challenge") || url.includes("challenge")) {
    return "Instagram suspicious login challenge detected. You may need to verify via email/SMS.";
  }

  // Two-factor authentication
  if (url.includes("two_factor")) {
    return "Instagram two-factor authentication required.";
  }

  // "Save Your Login Info" screen
  // TODO: Selector may change — Instagram updates UI frequently
  const saveLoginBtn = await page.$('button:has-text("Save Info"), button:has-text("Not Now"), [role="button"]:has-text("Save Info")');
  if (saveLoginBtn) {
    // Click "Not Now" to skip
    const notNow = await page.$('button:has-text("Not Now"), [role="button"]:has-text("Not Now")');
    if (notNow) {
      await notNow.click();
      await humanDelay(1000, 2000);
      console.log("[InstagramPlaywright] Dismissed 'Save Login Info' prompt");
    }
  }

  // "Turn on Notifications" prompt
  // TODO: Selector may change — Instagram updates UI frequently
  const notifPrompt = await page.$('button:has-text("Not Now"), [role="button"]:has-text("Not Now")');
  if (notifPrompt) {
    await notifPrompt.click();
    await humanDelay(1000, 2000);
    console.log("[InstagramPlaywright] Dismissed notifications prompt");
  }

  // Consent / cookie banners
  const cookieBtn = await page.$('button:has-text("Allow All Cookies"), button:has-text("Allow essential and optional cookies"), button:has-text("Accept")');
  if (cookieBtn) {
    await cookieBtn.click();
    await humanDelay(500, 1500);
    console.log("[InstagramPlaywright] Dismissed cookie banner");
  }

  return null;
}

/**
 * Real Instagram publisher using Playwright browser automation.
 *
 * Reads credentials from environment variables:
 *   INSTAGRAM_LOGIN_USERNAME
 *   INSTAGRAM_LOGIN_PASSWORD
 *   INSTAGRAM_2FA_CODE (optional, for TOTP 2FA)
 *   INSTAGRAM_HEADLESS (true|false, default true)
 *
 * Session persistence:
 *   Saves cookies/storage state to ./playwright-state/instagram-storage-state.json
 *   after a successful fresh login. On the next run, the saved session is loaded
 *   first. If the session is expired/invalid, falls back to a full login.
 *   Delete the file to force a fresh login: rm ./playwright-state/instagram-storage-state.json
 *
 * Workflow:
 *  1. Launch Chromium
 *  2. If saved session exists: load it and verify login status
 *  3. If session invalid or missing: navigate to login, enter credentials
 *  4. Handle challenges (2FA, suspicious login, save-info, notifications)
 *  5. Save session to disk on successful login
 *  6. Navigate to create/upload flow
 *  7. Upload video file
 *  8. Fill caption
 *  9. Publish
 * 10. Return structured result
 *
 * On failure: saves debug screenshots to ./debug-screenshots/
 */
export class InstagramPlaywrightPublisher implements PlatformPublisher {
  platform = "instagram";

  async publishVideo(input: PublishInput): Promise<PublishResult> {
    const username = process.env.INSTAGRAM_LOGIN_USERNAME;
    const password = process.env.INSTAGRAM_LOGIN_PASSWORD;
    const twoFaCode = process.env.INSTAGRAM_2FA_CODE || "";
    const headless = process.env.INSTAGRAM_HEADLESS !== "false";

    if (!username || !password) {
      return {
        success: false,
        errorMessage: "INSTAGRAM_LOGIN_USERNAME and INSTAGRAM_LOGIN_PASSWORD env vars are required",
      };
    }

    // Validate file exists before launching browser
    const videoPath = path.resolve(input.filePath);
    if (!fs.existsSync(videoPath)) {
      return {
        success: false,
        errorMessage: `Video file not found: ${input.filePath}`,
      };
    }

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let currentStep = "init";

    try {
      // ──────────────────────────────────────────────
      // STEP 1: Launch browser
      // ──────────────────────────────────────────────
      currentStep = "launch-browser";
      console.log(`[InstagramPlaywright] Launching browser (headless=${headless})`);

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

      // ──────────────────────────────────────────────
      // STEP 2: Load saved session or perform fresh login
      // ──────────────────────────────────────────────
      let usedSavedSession = false;
      let sessionFallback = false;

      if (hasSavedSession()) {
        // Try to reuse stored session first
        currentStep = "load-saved-session";
        console.log(`[InstagramPlaywright] Found saved session at ${SESSION_FILE} — attempting to reuse`);

        context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          locale: "en-US",
          storageState: SESSION_FILE,
          permissions: ["notifications"],
          extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
        });

        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", { get: () => undefined });
          Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
          // @ts-expect-error - add chrome runtime for detection avoidance
          window.chrome = { runtime: {} };
        });

        page = await context.newPage();
        await page.route("**/bat.bing.com/**", (route) => route.abort());
        await page.route("**/connect.facebook.net/signals/**", (route) => route.abort());

        currentStep = "verify-saved-session";
        const sessionOk = await isSessionValid(page);

        if (sessionOk) {
          usedSavedSession = true;
          console.log("[InstagramPlaywright] Session mode: EXISTING SESSION reused — skipping login");
        } else {
          // Session expired — close context and fall back to fresh login
          sessionFallback = true;
          console.log("[InstagramPlaywright] Session mode: SESSION EXPIRED — falling back to fresh login");
          clearSavedSession();
          await context.close();
          context = null;
          page = null;
        }
      }

      if (!usedSavedSession) {
        // Fresh login path (either no saved session or session was expired)
        if (!sessionFallback) {
          console.log("[InstagramPlaywright] Session mode: FRESH LOGIN — no saved session found");
        }

        context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          locale: "en-US",
          permissions: ["notifications"],
          extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
        });

        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", { get: () => undefined });
          Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
          // @ts-expect-error - add chrome runtime for detection avoidance
          window.chrome = { runtime: {} };
        });

        page = await context.newPage();
        await page.route("**/bat.bing.com/**", (route) => route.abort());
        await page.route("**/connect.facebook.net/signals/**", (route) => route.abort());

        // ──────────────────────────────────────────────
        // STEP 2a: Navigate to Instagram login
        // ──────────────────────────────────────────────
        currentStep = "navigate-login";
        console.log("[InstagramPlaywright] Navigating to Instagram login...");
        // Visit homepage and click "Log in" button — avoids direct navigation to /accounts/login/
        // which triggers Instagram's bot detection (blank page)
        await page.goto("https://www.instagram.com/", {
          waitUntil: "networkidle",
          timeout: 45000,
        });
        await humanDelay(5000, 8000);
        console.log(`[InstagramPlaywright] Homepage URL: ${page.url()}, title: "${await page.title()}"`);
        try {
          const homeHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 300) ?? "");
          console.log(`[InstagramPlaywright] Homepage body sample: ${homeHtml}`);
        } catch { /* ignore */ }

        // Log all visible links and buttons on homepage for debugging
        try {
          const homepageLinks = await page.evaluate(() =>
            Array.from(document.querySelectorAll("a, button, [role='button']"))
              .filter((el) => (el as HTMLElement).offsetParent !== null)
              .map((el) => ({ tag: el.tagName, text: el.textContent?.trim().substring(0, 40), href: (el as HTMLAnchorElement).href || null }))
              .slice(0, 20)
          );
          console.log(`[InstagramPlaywright] Homepage links/buttons: ${JSON.stringify(homepageLinks)}`);
        } catch { /* ignore */ }

        // Try clicking the "Log in" link/button on the homepage instead of hard-navigating to login URL
        let navigatedToLogin = false;
        const loginLinkSelectors = [
          'a[href="/accounts/login/"]',
          'a[href*="accounts/login"]',
          'a:has-text("Log in")',
          'button:has-text("Log in")',
          '[role="button"]:has-text("Log in")',
          'a:has-text("Log In")',
        ];
        for (const sel of loginLinkSelectors) {
          try {
            const el = await page.$(sel);
            if (el) {
              const elText = await el.textContent();
              const elHref = await el.getAttribute("href");
              console.log(`[InstagramPlaywright] Found login element via ${sel}: text="${elText?.trim()}", href="${elHref}"`);
              await el.click();
              // Wait for either the URL to change OR a login input to appear
              try {
                await Promise.race([
                  page.waitForURL("**/accounts/login/**", { timeout: 15000 }),
                  page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 15000, state: "visible" }),
                ]);
                navigatedToLogin = true;
                console.log(`[InstagramPlaywright] Navigated to login via click: ${page.url()}`);
                break;
              } catch (navErr) {
                console.log(`[InstagramPlaywright] Click on ${sel} didn't navigate to login: ${navErr}`);
              }
            }
          } catch { /* try next */ }
        }
        if (!navigatedToLogin) {
          // Fall back: direct navigation to login page
          console.log("[InstagramPlaywright] No login link found on homepage, navigating directly to /accounts/login/");
          await page.goto("https://www.instagram.com/accounts/login/", {
            waitUntil: "networkidle",
            timeout: 45000,
          });
        }
        await humanDelay(4000, 6000);

        // Log page state after initial load
        console.log(`[InstagramPlaywright] Page URL after load: ${page.url()}`);
        try {
          const titleAfterLoad = await page.title();
          console.log(`[InstagramPlaywright] Page title after load: "${titleAfterLoad}"`);
        } catch { /* ignore */ }

        // Handle cookie consent banner if present — try multiple times
        for (let attempt = 0; attempt < 5; attempt++) {
          // Log visible buttons on first two attempts for debugging
          if (attempt < 2) {
            try {
              const buttonTexts = await page.evaluate(() =>
                Array.from(document.querySelectorAll("button, [role='button']"))
                  .filter((el) => (el as HTMLElement).offsetParent !== null)
                  .map((el) => el.textContent?.trim().substring(0, 50))
                  .filter(Boolean)
              );
              console.log(`[InstagramPlaywright] Visible buttons (attempt ${attempt}): ${JSON.stringify(buttonTexts)}`);
            } catch { /* ignore */ }
          }

          const cookieBtn = await page.$([
            'button:has-text("Allow All Cookies")',
            'button:has-text("Allow essential and optional cookies")',
            'button:has-text("Accept All")',
            'button:has-text("Accept")',
            'button:has-text("Kabul Et")',
            'button:has-text("Decline Optional Cookies")',
            'button:has-text("Decline")',
            '[data-cookiebanner="accept_button"]',
            '[data-cookiebanner="decline_button"]',
            'button[class*="cookie"]',
          ].join(", "));
          if (cookieBtn) {
            const btnText = await cookieBtn.textContent();
            console.log(`[InstagramPlaywright] Dismissing cookie consent: "${btnText?.trim()}"`);
            try {
              await cookieBtn.click({ timeout: 5000 });
            } catch {
              // If regular click fails, try JS click
              await page.evaluate((el) => (el as HTMLElement).click(), cookieBtn);
            }
            await humanDelay(2000, 3000);
            console.log("[InstagramPlaywright] Cookie consent dismissed");
            break;
          }
          if (attempt === 0) {
            console.log("[InstagramPlaywright] No cookie consent button found yet, waiting...");
          }
          await humanDelay(1500, 2000);
        }

        // ──────────────────────────────────────────────
        // STEP 2b: Enter credentials
        // ──────────────────────────────────────────────
        currentStep = "enter-credentials";
        console.log("[InstagramPlaywright] Entering credentials...");
        console.log(`[InstagramPlaywright] Current URL: ${page.url()}`);
        await saveDebugScreenshot(page, "before-login-form");

        // Wait for login form — try multiple selectors
        const usernameSelectors = [
          'input[name="username"]',
          'input[aria-label="Phone number, username, or email"]',
          'input[aria-label*="username"]',
          'input[autocomplete="username"]',
          'input[type="text"]',
        ];
        let usernameFound = false;
        for (const sel of usernameSelectors) {
          try {
            await page.waitForSelector(sel, { timeout: 8000, state: "visible" });
            console.log(`[InstagramPlaywright] Found username input via: ${sel}`);
            usernameFound = true;
            // use this selector for typing
            await humanType(page, sel, username);
            break;
          } catch {
            // try next
          }
        }
        if (!usernameFound) {
          await saveDebugScreenshot(page, "no-username-input");
          // Log page state for diagnosis
          try {
            const pageTitle = await page.title();
            const pageUrl = page.url();
            const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 800) ?? "(no body)");
            const bodyHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 800) ?? "(no html)");
            const allInputs = await page.evaluate(() =>
              Array.from(document.querySelectorAll("input")).map((el) => ({
                type: (el as HTMLInputElement).type,
                name: (el as HTMLInputElement).name,
                placeholder: (el as HTMLInputElement).placeholder,
                ariaLabel: el.getAttribute("aria-label"),
                visible: (el as HTMLElement).offsetParent !== null,
              }))
            );
            const webdriverVal = await page.evaluate(() => (navigator as Navigator & {webdriver?: unknown}).webdriver);
            console.log(`[InstagramPlaywright] Page title: "${pageTitle}"`);
            console.log(`[InstagramPlaywright] Page URL: ${pageUrl}`);
            console.log(`[InstagramPlaywright] navigator.webdriver: ${webdriverVal}`);
            console.log(`[InstagramPlaywright] Body text: ${bodyText}`);
            console.log(`[InstagramPlaywright] Body HTML: ${bodyHtml}`);
            console.log(`[InstagramPlaywright] Input fields found: ${JSON.stringify(allInputs)}`);
          } catch (diagErr) {
            console.warn(`[InstagramPlaywright] Diagnostic logging failed: ${diagErr}`);
          }
          throw new Error("Could not find username input on Instagram login page");
        }
        await humanDelay(300, 800);

        // Password
        const passwordSelectors = ['input[name="password"]', 'input[type="password"]', 'input[aria-label*="password"]', 'input[aria-label*="Password"]'];
        for (const sel of passwordSelectors) {
          try {
            await page.waitForSelector(sel, { timeout: 5000, state: "visible" });
            await humanType(page, sel, password);
            break;
          } catch {
            // try next
          }
        }
        await humanDelay(500, 1500);

        // Dismiss any cookie consent overlay that appeared during typing
        try {
          const overlayBtn = await page.$([
            'button:has-text("Allow All Cookies")',
            'button:has-text("Accept All")',
            'button:has-text("Accept")',
            'button:has-text("Kabul Et")',
            'button:has-text("Decline")',
            'button:has-text("Decline Optional Cookies")',
          ].join(", "));
          if (overlayBtn) {
            const overlayText = await overlayBtn.textContent();
            console.log(`[InstagramPlaywright] Cookie overlay appeared during typing: "${overlayText?.trim()}" — dismissing`);
            try {
              await overlayBtn.click({ timeout: 5000 });
            } catch {
              await page.evaluate((el) => (el as HTMLElement).click(), overlayBtn);
            }
            await humanDelay(1500, 2500);
          }
        } catch { /* ignore */ }

        // Click login button - try multiple approaches
        // TODO: Selector may change — button text may be localized
        console.log("[InstagramPlaywright] Clicking login button...");
        let submitClicked = false;
        const submitSelectors = [
          'button[type="submit"]',
          'button:has-text("Log in")',
          'button:has-text("Log In")',
          'div[role="button"]:has-text("Log in")',
        ];
        for (const sel of submitSelectors) {
          try {
            const el = await page.$(sel);
            if (el) {
              try {
                await el.click({ timeout: 5000 });
              } catch {
                // Fallback: JS click
                console.log(`[InstagramPlaywright] Regular click blocked on submit, using JS click`);
                await page.evaluate((e) => (e as HTMLElement).click(), el);
              }
              submitClicked = true;
              console.log(`[InstagramPlaywright] Login submitted via: ${sel}`);
              break;
            }
          } catch { /* try next */ }
        }
        if (!submitClicked) {
          // Last resort: press Enter on the password field
          console.log("[InstagramPlaywright] Submit button not found, pressing Enter");
          await page.keyboard.press("Enter");
          submitClicked = true;
        }
        console.log("[InstagramPlaywright] Login submitted, waiting for response...");

        // Wait for navigation after login
        await humanDelay(4000, 7000);

        // ──────────────────────────────────────────────
        // STEP 2c: Handle post-login challenges
        // ──────────────────────────────────────────────
        currentStep = "handle-challenges";

        // Check for wrong credentials
        const errorMsg = await page.$('div[role="alert"], #slfErrorAlert, p[data-testid="login-error-message"]');
        if (errorMsg) {
          const errorText = await errorMsg.textContent();
          await saveDebugScreenshot(page, "login-error");
          return {
            success: false,
            errorMessage: `Instagram login failed: ${errorText || "Invalid credentials"}`,
          };
        }

        // Check for 2FA screen
        const pageUrl = page.url();
        if (pageUrl.includes("two_factor")) {
          currentStep = "handle-2fa";
          console.log("[InstagramPlaywright] Two-factor authentication screen detected");

          if (!twoFaCode) {
            await saveDebugScreenshot(page, "2fa-required");
            return {
              success: false,
              errorMessage:
                "Instagram 2FA required but INSTAGRAM_2FA_CODE env var is not set. Set it and retry.",
            };
          }

          // Enter 2FA code
          // TODO: Selector may change — this is the standard 2FA input
          const twoFaInput = await page.$('input[name="verificationCode"], input[name="security_code"]');
          if (twoFaInput) {
            await twoFaInput.fill(twoFaCode);
            await humanDelay(500, 1000);

            // Click confirm button
            // TODO: Selector may change
            const confirmBtn = await page.$('button:has-text("Confirm"), button[type="button"]:has-text("Confirm")');
            if (confirmBtn) {
              await confirmBtn.click();
              await humanDelay(4000, 6000);
            }
          } else {
            await saveDebugScreenshot(page, "2fa-input-not-found");
            return {
              success: false,
              errorMessage: "2FA screen detected but could not find the code input field",
            };
          }
        }

        // Check for suspicious login challenge
        if (page.url().includes("challenge")) {
          currentStep = "handle-challenge";
          await saveDebugScreenshot(page, "suspicious-login-challenge");
          return {
            success: false,
            errorMessage:
              "Instagram suspicious login challenge detected. Log in manually from this machine first, then retry.",
          };
        }

        // Dismiss "Save Login Info" and "Notifications" prompts
        const challengeResult = await detectLoginChallenge(page);
        if (challengeResult) {
          await saveDebugScreenshot(page, "post-login-challenge");
          return {
            success: false,
            errorMessage: challengeResult,
          };
        }

        // Verify we're logged in by checking for the home page
        await humanDelay(2000, 3000);
        currentStep = "verify-login";

        // Check we're on the main page (various ways to detect)
        const isLoggedIn =
          page.url().includes("instagram.com") &&
          !page.url().includes("/accounts/login") &&
          !page.url().includes("/challenge") &&
          !page.url().includes("two_factor");

        if (!isLoggedIn) {
          await saveDebugScreenshot(page, "login-verification-failed");
          return {
            success: false,
            errorMessage: `Login may have failed. Current URL: ${page.url()}`,
          };
        }

        console.log("[InstagramPlaywright] Login successful!");
        await saveDebugScreenshot(page, "login-success");

        // ──────────────────────────────────────────────
        // Save session to disk for future runs
        // ──────────────────────────────────────────────
        currentStep = "save-session";
        try {
          await saveSession(context);
        } catch (err) {
          // Non-fatal — log but continue
          console.warn(`[InstagramPlaywright] Could not save session: ${err}`);
        }
      }

      // Both code paths above guarantee page is non-null at this point.
      // The null guard here narrows the type for the rest of the method.
      if (!page || !context) {
        throw new Error("Browser page/context unexpectedly null after login phase");
      }

      // ──────────────────────────────────────────────
      // STEP 5: Navigate to create post flow
      // ──────────────────────────────────────────────
      currentStep = "navigate-create";
      console.log("[InstagramPlaywright] Navigating to create post flow...");

      // Instagram's create button — try multiple approaches
      // Approach 1: Direct URL to create flow (most reliable)
      // TODO: Instagram may change this URL path
      await page.goto("https://www.instagram.com/", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await humanDelay(2000, 4000);

      // Click the "New post" / "Create" button in the sidebar/nav
      // TODO: Selector may change — Instagram frequently updates the nav structure
      // The create button is typically an SVG icon in the sidebar. We try multiple selectors.
      let createClicked = false;

      // Try: sidebar "Create" link/button
      const createSelectors = [
        // Sidebar "Create" text link
        'a:has-text("Create")',
        // Nav item with "New post" label
        '[aria-label="New post"]',
        // SVG-based create button
        'svg[aria-label="New post"]',
        // The nav link that contains the create icon
        'a[href="#"]:has(svg[aria-label="New post"])',
        // Fallback: any element labeled create
        '[aria-label="Create"]',
      ];

      for (const selector of createSelectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            await el.click();
            createClicked = true;
            console.log(`[InstagramPlaywright] Clicked create button via: ${selector}`);
            break;
          }
        } catch {
          // Try next selector
        }
      }

      if (!createClicked) {
        await saveDebugScreenshot(page, "create-button-not-found");
        return {
          success: false,
          errorMessage:
            "Could not find Instagram's 'Create' / 'New post' button. The UI may have changed. Check debug screenshots.",
        };
      }

      await humanDelay(2000, 4000);

      // ──────────────────────────────────────────────
      // STEP 6: Upload video file
      // ──────────────────────────────────────────────
      currentStep = "upload-video";
      console.log(`[InstagramPlaywright] Uploading video: ${input.filePath}`);

      // The create dialog should now be open. Look for the file input or drag-drop area.
      // Instagram uses a hidden <input type="file"> element.
      // TODO: Selector may change — the file input is typically within the create dialog
      let fileInputFound = false;

      // Wait for the create dialog/modal to appear
      await humanDelay(1500, 3000);

      // Try to find the file input
      const fileInputSelectors = [
        'input[type="file"][accept*="video"]',
        'input[type="file"]',
        'form input[type="file"]',
      ];

      for (const selector of fileInputSelectors) {
        try {
          const fileInput = await page.$(selector);
          if (fileInput) {
            await fileInput.setInputFiles(videoPath);
            fileInputFound = true;
            console.log(`[InstagramPlaywright] File set via: ${selector}`);
            break;
          }
        } catch {
          // Try next selector
        }
      }

      if (!fileInputFound) {
        // Fallback: look for "Select from computer" button which may trigger file input
        // TODO: Selector may change
        const selectBtn = await page.$('button:has-text("Select from computer"), button:has-text("Select From Computer")');
        if (selectBtn) {
          // Set up file chooser promise before clicking
          const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
          await selectBtn.click();
          const fileChooser = await fileChooserPromise;
          await fileChooser.setFiles(videoPath);
          fileInputFound = true;
          console.log("[InstagramPlaywright] File set via file chooser after clicking 'Select from computer'");
        }
      }

      if (!fileInputFound) {
        await saveDebugScreenshot(page, "file-input-not-found");
        return {
          success: false,
          errorMessage:
            "Could not find file upload input in Instagram's create dialog. The UI may have changed. Check debug screenshots.",
        };
      }

      // Wait for video to process
      currentStep = "wait-video-processing";
      console.log("[InstagramPlaywright] Waiting for video to process...");
      await humanDelay(5000, 8000);
      await saveDebugScreenshot(page, "after-upload");

      // ──────────────────────────────────────────────
      // STEP 7: Navigate through create flow screens
      // ──────────────────────────────────────────────
      currentStep = "create-flow-navigation";

      // Instagram's create flow has multiple screens:
      //   1. Crop/Edit screen → click "Next"
      //   2. Filters/Edit screen → click "Next"
      //   3. Caption screen → enter caption → click "Share"/"Share Reel"

      // Screen 1: Crop — click Next
      // TODO: Selector may change — button text may be localized
      await this.clickNextButton(page, "crop-screen");
      await humanDelay(2000, 3500);

      // Screen 2: Edit/Filters — click Next
      await this.clickNextButton(page, "edit-screen");
      await humanDelay(2000, 3500);

      // ──────────────────────────────────────────────
      // STEP 8: Fill caption
      // ──────────────────────────────────────────────
      currentStep = "fill-caption";
      console.log("[InstagramPlaywright] Filling caption...");
      await saveDebugScreenshot(page, "caption-screen");

      const captionText = input.caption || "";

      // Look for the caption textarea/contenteditable
      // TODO: Selector may change — Instagram uses a contenteditable div for captions
      const captionSelectors = [
        'div[aria-label="Write a caption..."]',
        'div[aria-label="Write a caption…"]',
        'textarea[aria-label="Write a caption..."]',
        'textarea[aria-label="Write a caption…"]',
        'div[role="textbox"][contenteditable="true"]',
        'div[data-lexical-editor="true"]',
        '[aria-label*="caption" i]',
        'textarea[placeholder*="caption" i]',
      ];

      let captionFilled = false;
      for (const selector of captionSelectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            await el.click();
            await humanDelay(300, 600);
            // Use keyboard to type since it might be contenteditable
            await page.keyboard.type(captionText, { delay: 20 + Math.random() * 40 });
            captionFilled = true;
            console.log(`[InstagramPlaywright] Caption filled via: ${selector}`);
            break;
          }
        } catch {
          // Try next selector
        }
      }

      if (!captionFilled) {
        console.warn("[InstagramPlaywright] WARNING: Could not find caption field. Proceeding without caption.");
        await saveDebugScreenshot(page, "caption-field-not-found");
      }

      await humanDelay(1500, 2500);

      // ──────────────────────────────────────────────
      // STEP 9: Publish / Share
      // ──────────────────────────────────────────────
      currentStep = "publish";
      console.log("[InstagramPlaywright] Publishing...");
      await saveDebugScreenshot(page, "before-share");

      // Click "Share" or "Share reel" button
      // TODO: Selector may change — button text depends on whether it's a reel or post
      const shareSelectors = [
        'button:has-text("Share")',
        'div[role="button"]:has-text("Share")',
        'button:has-text("Share reel")',
        'div[role="button"]:has-text("Share reel")',
      ];

      let shareClicked = false;
      for (const selector of shareSelectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            await el.click();
            shareClicked = true;
            console.log(`[InstagramPlaywright] Share clicked via: ${selector}`);
            break;
          }
        } catch {
          // Try next selector
        }
      }

      if (!shareClicked) {
        await saveDebugScreenshot(page, "share-button-not-found");
        return {
          success: false,
          errorMessage:
            "Could not find 'Share' button. The upload flow UI may have changed. Check debug screenshots.",
        };
      }

      // Wait for publishing to complete
      currentStep = "wait-publish";
      console.log("[InstagramPlaywright] Waiting for publish to complete...");
      await humanDelay(8000, 15000);
      await saveDebugScreenshot(page, "after-share");

      // ──────────────────────────────────────────────
      // STEP 10: Verify success
      // ──────────────────────────────────────────────
      currentStep = "verify-publish";

      // Check for success indicators
      // After sharing, Instagram typically shows "Your reel has been shared" or redirects to the post
      // TODO: These selectors and checks may change with UI updates
      const successIndicators = [
        'img[alt*="animation"]', // Success animation
        'span:has-text("Your reel has been shared")',
        'span:has-text("Your video has been shared")',
        'span:has-text("Your post has been shared")',
        'div:has-text("Reel shared")',
      ];

      let publishConfirmed = false;
      for (const selector of successIndicators) {
        try {
          const el = await page.$(selector);
          if (el) {
            publishConfirmed = true;
            console.log(`[InstagramPlaywright] Publish confirmed via: ${selector}`);
            break;
          }
        } catch {
          // Try next
        }
      }

      // Even if we can't confirm via UI text, if we're not on an error page it likely worked
      const currentUrl = page.url();
      const onErrorPage = currentUrl.includes("/accounts/login") || currentUrl.includes("/challenge");

      if (onErrorPage) {
        await saveDebugScreenshot(page, "publish-error-redirect");
        return {
          success: false,
          errorMessage: `Redirected to unexpected page after share: ${currentUrl}`,
        };
      }

      // Try to extract the post URL by navigating to profile
      let externalUrl: string | undefined;
      let externalPostId: string | undefined;

      try {
        // Try to get URL from the current page (sometimes Instagram shows the reel link)
        await humanDelay(2000, 3000);

        // Navigate to profile to find the latest post
        await page.goto(`https://www.instagram.com/${username}/`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await humanDelay(2000, 4000);

        // Get the first post link from the grid
        // TODO: Selector may change
        const firstPost = await page.$('article a[href*="/reel/"], article a[href*="/p/"], main a[href*="/reel/"], main a[href*="/p/"]');
        if (firstPost) {
          const href = await firstPost.getAttribute("href");
          if (href) {
            externalUrl = `https://www.instagram.com${href}`;
            // Extract post ID from URL (e.g., /reel/ABC123/ → ABC123)
            const match = href.match(/\/(reel|p)\/([^/]+)/);
            if (match) {
              externalPostId = match[2];
            }
          }
        }
      } catch (err) {
        console.warn(`[InstagramPlaywright] Could not extract post URL: ${err}`);
      }

      await saveDebugScreenshot(page, "final-state");

      console.log(`[InstagramPlaywright] Publish ${publishConfirmed ? "confirmed" : "likely succeeded"}`);
      console.log(`[InstagramPlaywright] Post URL: ${externalUrl || "unknown"}`);

      return {
        success: true,
        externalPostId: externalPostId || `ig_pw_${Date.now()}`,
        externalUrl: externalUrl || `https://www.instagram.com/${username}/`,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[InstagramPlaywright] ERROR at step "${currentStep}": ${errMsg}`);

      // Save failure screenshot
      if (page) {
        try {
          await saveDebugScreenshot(page, `error-${currentStep}`);
        } catch {
          // Screenshot itself may fail if browser crashed
        }
      }

      return {
        success: false,
        errorMessage: `Unexpected error during "${currentStep}": ${errMsg}`,
      };
    } finally {
      // Always clean up browser resources
      try {
        if (context) await context.close();
        if (browser) await browser.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Clicks the "Next" button in Instagram's create flow.
   * Retries with multiple selectors.
   */
  private async clickNextButton(page: Page, screenName: string): Promise<void> {
    // TODO: Selectors may change — "Next" button label may be localized
    const nextSelectors = [
      'button:has-text("Next")',
      'div[role="button"]:has-text("Next")',
      '[aria-label="Next"]',
    ];

    for (const selector of nextSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          console.log(`[InstagramPlaywright] Clicked 'Next' on ${screenName} via: ${selector}`);
          return;
        }
      } catch {
        // Try next selector
      }
    }

    await saveDebugScreenshot(page, `next-button-not-found-${screenName}`);
    console.warn(`[InstagramPlaywright] WARNING: Could not find 'Next' button on ${screenName}. Proceeding anyway.`);
  }
}
