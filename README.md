# Video Poster — Automated Short-Video Posting Tool

Internal admin tool for scheduling and posting short videos to TikTok, Instagram Reels, and YouTube Shorts.

## Tech Stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **Backend:** Next.js API routes
- **Database:** SQLite via Prisma 5
- **Scheduler:** node-cron
- **Auth:** JWT-based (single admin user from env)
- **File storage:** Local filesystem (`/uploads`)

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Set up database

```bash
npx prisma db push
npm run db:seed
```

### 4. Start development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the credentials from `.env` (default: `admin` / `admin123`).

## Project Structure

```
src/
├── app/
│   ├── api/              # API routes (accounts, videos, scheduler, logs, settings)
│   ├── dashboard/        # Dashboard pages (accounts, queue, logs, settings)
│   ├── login/            # Login page
│   └── layout.tsx        # Root layout
├── lib/
│   ├── prisma.ts         # Prisma client singleton
│   ├── auth.ts           # JWT auth helpers
│   ├── logger.ts         # DB-backed logging
│   ├── scheduler.ts      # node-cron scheduler
│   └── settings.ts       # App settings helpers
├── services/
│   ├── publishers/       # Platform publisher interface + implementations
│   │   ├── types.ts      # PlatformPublisher interface
│   │   ├── registry.ts   # Publisher factory
│   │   ├── youtube-publisher.ts
│   │   ├── instagram-publisher.ts
│   │   └── tiktok-publisher.ts
│   ├── queue-processor.ts # Queue processing logic
│   └── init.ts           # App initialization
├── middleware.ts          # Route protection
prisma/
├── schema.prisma          # Data models
├── seed.ts               # Seed script
uploads/                   # Video file storage
```

## Features

- **Dashboard** — Stats cards, scheduler status, recent logs
- **Account Management** — Add/edit/delete social media accounts with token storage
- **Video Queue** — Upload videos, set captions/hashtags, choose target platforms/accounts
- **Automatic Scheduler** — Posts next queued video every N hours (configurable)
- **Manual Run** — "Run Now" button for testing
- **Logs** — Filterable log viewer for all publish activity
- **Settings** — Posting interval, auto-delete, max retries, timezone, caption suffix

## Platform Integration

Publishers are abstracted behind the `PlatformPublisher` interface.

### Instagram (Playwright — Real)

Instagram publishing uses Playwright browser automation to upload Reels through the Instagram web UI.

#### Setup

```bash
# 1. Install Playwright browsers (one-time)
npx playwright install chromium

# 2. Set environment variables in .env
INSTAGRAM_PROVIDER=playwright
INSTAGRAM_LOGIN_USERNAME=your_instagram_username
INSTAGRAM_LOGIN_PASSWORD=your_instagram_password
INSTAGRAM_2FA_CODE=              # Optional: TOTP code if 2FA is enabled
INSTAGRAM_HEADLESS=false         # Set to true for headless, false to watch the browser
```

#### Session Persistence

After a successful login, the publisher saves cookies and localStorage to `./playwright-state/instagram-storage-state.json`. On the next run, it loads this saved session and checks if it's still valid before attempting a fresh login.

Logged session modes:
- `EXISTING SESSION reused` — skipped login entirely, used cookies from disk
- `FRESH LOGIN` — no saved session found, logged in with credentials
- `SESSION EXPIRED — falling back to fresh login` — saved session was invalid, deleted it and logged in fresh

To clear the saved session manually (forces a fresh login on next run):
```bash
# Delete the session file
del playwright-state\instagram-storage-state.json
# Or on Mac/Linux: rm playwright-state/instagram-storage-state.json
```

The `./playwright-state/` folder is gitignored — it never gets committed.

#### Testing a Single Upload

1. Start the dev server: `npm run dev`
2. Open `http://localhost:3000` and log in
3. Go to **Accounts** → ensure you have an Instagram account added
4. Go to **Queue** → upload a short video (.mp4), set caption/hashtags, select the Instagram account
5. Click **Run Now** on the dashboard (or from the scheduler API: `POST /api/scheduler`)
6. Watch the logs page for real-time status
7. If `INSTAGRAM_HEADLESS=false`, the Chromium browser window will be visible during the upload

#### Debug Screenshots

On failure (or at key steps), screenshots are saved to `./debug-screenshots/`. This folder is gitignored.

#### Known Limitations

- Instagram may trigger a **suspicious login challenge** on first login from a new machine. Log in manually from the same machine/IP first to "trust" the device.
- If **2FA is enabled**, set `INSTAGRAM_2FA_CODE` with a valid TOTP code. The code is time-sensitive, so it must be fresh when the job runs.
- Instagram's web UI **selectors change frequently**. If the upload flow breaks, check the debug screenshots and search for `TODO: Selector may change` comments in `src/services/publishers/instagram-playwright.publisher.ts`.
- Video processing on Instagram's side can take time. The publisher waits, but very long videos may time out.
- To switch back to mock mode: set `INSTAGRAM_PROVIDER=mock` in `.env`.

### YouTube (Official API — Real)

YouTube publishing uses the [YouTube Data API v3](https://developers.google.com/youtube/v3/docs/videos/insert) with resumable uploads.

#### Prerequisites

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **YouTube Data API v3** for your project
3. Create **OAuth 2.0 Client ID** credentials (type: Web application)
4. Add `http://localhost:3000/api/auth/youtube/callback` as an authorized redirect URI
5. Note your Client ID and Client Secret

#### Setup

```bash
# Set env vars in .env
YOUTUBE_PROVIDER=official
YOUTUBE_CLIENT_ID=your_google_client_id
YOUTUBE_CLIENT_SECRET=your_google_client_secret
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/auth/youtube/callback
YOUTUBE_UPLOAD_PRIVACY_STATUS=private   # private | unlisted | public
YOUTUBE_CATEGORY_ID=22                  # 22 = People & Blogs
```

#### YouTube OAuth — Getting Tokens

YouTube requires Google OAuth user authorization. Two methods are supported:

**Method A: OAuth flow (recommended)**

1. Go to **Dashboard → Accounts** and create a YouTube account entry
2. Visit `http://localhost:3000/api/auth/youtube?accountId=YOUR_ACCOUNT_ID`
3. You'll be redirected to Google's consent screen
4. After authorizing, you'll be redirected back and tokens will be saved automatically

**Method B: Manual token entry (for testing)**

1. Obtain access + refresh tokens through [Google OAuth Playground](https://developers.google.com/oauthplayground/) or another OAuth client
2. Scopes needed: `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`
3. Go to **Dashboard → Accounts**, edit the YouTube account, and paste the tokens

Tokens are stored in `SocialAccount.accessToken` and `SocialAccount.refreshToken`.

#### Token Refresh

- Google access tokens expire every **1 hour**
- The publisher automatically refreshes tokens before each publish if `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` are set
- New access tokens are persisted to the database
- Google refresh tokens do **not** expire unless the user revokes access or the OAuth app's consent screen is in "Testing" mode with >7 days since last use

#### Resumable Upload

The publisher uses the YouTube resumable upload protocol:
- Files ≤5 MB: uploaded in a single PUT request
- Files >5 MB: uploaded in 5 MB chunks (256 KB-aligned)
- On success, YouTube returns the video ID and resource immediately
- Upload session URIs support resuming after network interruption (not yet implemented — retries restart the full upload)

#### Shorts-Specific Handling

- The publisher appends `#Shorts` to the video title to help YouTube classify the upload as a Short
- Warnings are logged if the file appears too large for a Short (>50 MB or >200 MB)
- Uploads are **never blocked** based on Shorts criteria — the API accepts the video regardless
- YouTube determines Shorts classification server-side based on duration (≤60s), aspect ratio, and title

#### Testing a Single Upload

1. `npm run dev`
2. Ensure a YouTube account exists in **Dashboard → Accounts** with valid OAuth tokens
3. Queue a video targeting the YouTube account
4. Click **Run Now** on the dashboard
5. Watch **Logs** for step-by-step progress: token refresh → Shorts check → init → upload → complete

#### Known Limitations

- **Quota**: YouTube Data API has a daily quota of 10,000 units. A `videos.insert` costs **1,600 units**, so roughly 6 uploads/day on the default quota. [Request a quota increase](https://support.google.com/youtube/contact/yt_api_form) if needed.
- **Testing mode**: If your Google Cloud OAuth consent screen is in "Testing" mode, refresh tokens expire after 7 days. Move to "Published" (requires verification for sensitive scopes) for long-lived tokens.
- **Privacy default**: Videos upload as `private` by default. Change `YOUTUBE_UPLOAD_PRIVACY_STATUS` in `.env` to `unlisted` or `public`.
- **No title field in queue**: The video title is derived from the caption (first line). For full control, the caption should start with the desired title.
- **Upload resume**: If a chunked upload is interrupted mid-way, the current implementation restarts from scratch (the session URI is not persisted). This is adequate for Shorts-length files.
- To switch back to mock mode: set `YOUTUBE_PROVIDER=mock` in `.env`

### TikTok (Official API — Real)

TikTok publishing uses the official [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started) (Direct Post with `FILE_UPLOAD`).

#### Prerequisites

1. Register an app at [developers.tiktok.com](https://developers.tiktok.com)
2. Add the **Content Posting API** product to your app
3. Enable **Direct Post** in the product configuration
4. Get approval for the `video.publish` scope
5. Register a redirect URI: `http://localhost:3000/api/auth/tiktok/callback`

#### Setup

```bash
# Set env vars in .env
TIKTOK_PROVIDER=official
TIKTOK_CLIENT_ID=your_client_key
TIKTOK_CLIENT_SECRET=your_client_secret
TIKTOK_REDIRECT_URI=http://localhost:3000/api/auth/tiktok/callback
```

#### TikTok OAuth — Getting Tokens

TikTok requires OAuth user authorization. Two methods are supported:

**Method A: OAuth flow (recommended)**

1. Go to **Dashboard → Accounts** and create a TikTok account entry
2. Visit `http://localhost:3000/api/auth/tiktok?accountId=YOUR_ACCOUNT_ID`
3. You'll be redirected to TikTok's authorization page
4. After authorizing, you'll be redirected back and tokens will be saved automatically

**Method B: Manual token entry (for testing)**

1. Obtain an access token and refresh token through TikTok's developer tools or another OAuth client
2. Go to **Dashboard → Accounts**, edit the TikTok account, and paste the tokens

Tokens are stored in the `SocialAccount.accessToken` and `SocialAccount.refreshToken` fields.

#### Token Refresh

- Access tokens expire every **24 hours**
- The publisher automatically refreshes tokens before each publish if `TIKTOK_CLIENT_ID` and `TIKTOK_CLIENT_SECRET` are set
- New tokens are persisted to the database
- Refresh tokens are valid for **365 days**

#### Testing a Single Upload

1. `npm run dev`
2. Ensure a TikTok account exists in **Dashboard → Accounts** with valid OAuth tokens
3. Queue a video targeting the TikTok account
4. Click **Run Now** on the dashboard
5. Watch **Logs** for step-by-step progress: token refresh → creator info → init → upload → poll → complete

#### Known Limitations

- **Unaudited apps** can only post to **private accounts** (SELF_ONLY privacy). After testing, submit your app for TikTok's audit to lift this restriction.
- **Daily post cap**: TikTok limits the number of posts per user per day via API
- The publisher uses `FILE_UPLOAD` upload mode. `PULL_FROM_URL` requires domain verification and is not yet implemented.
- **Privacy level**: The publisher defaults to `SELF_ONLY` since unaudited clients require it. Once audited, it will use `PUBLIC_TO_EVERYONE` when available.
- To switch back to mock mode: set `TIKTOK_PROVIDER=mock` in `.env`

All three platforms can fall back to mock mode by setting `<PLATFORM>_PROVIDER=mock` in `.env`.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run db:push` | Push schema to database |
| `npm run db:seed` | Seed default admin + settings |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Reset database |

## Video Queue Workflow

1. Upload video file with caption, hashtags, and target accounts
2. Video enters queue with status `queued`
3. Scheduler picks next FIFO item, marks as `processing`
4. Publishes to each target platform/account
5. If all succeed → `completed`, file deleted (if auto-delete on)
6. If some fail → `partially_posted` or re-queued for retry
7. After max retries → `failed`

## Testing Checklist

Use this checklist for manual end-to-end platform testing. Each section assumes the dev server is running (`npm run dev`) and you are logged in at `http://localhost:3000`.

### Instagram

- [ ] Set `INSTAGRAM_PROVIDER=playwright` in `.env`
- [ ] Set `INSTAGRAM_LOGIN_USERNAME` and `INSTAGRAM_LOGIN_PASSWORD` in `.env`
- [ ] Run `npx playwright install chromium` (one-time)
- [ ] Create an Instagram account in **Dashboard → Accounts**
- [ ] Queue a short vertical .mp4 video targeting the Instagram account
- [ ] Click **Run Now** on the dashboard
- [ ] Verify console logs show: session check → login/reuse → navigate create → upload → caption → share
- [ ] Verify the **Logs** page shows success with an external post URL
- [ ] Check the Instagram account for the posted Reel
- [ ] On second run, verify session reuse (console should say "EXISTING SESSION reused")
- [ ] On failure, check `./debug-screenshots/` for step-level screenshots

### TikTok

- [ ] Set `TIKTOK_PROVIDER=official` in `.env`
- [ ] Set `TIKTOK_CLIENT_ID` and `TIKTOK_CLIENT_SECRET` in `.env`
- [ ] Create a TikTok account in **Dashboard → Accounts**
- [ ] Authorize via `http://localhost:3000/api/auth/tiktok?accountId=YOUR_ACCOUNT_ID`
- [ ] Verify tokens are stored (check account details for accessToken / refreshToken)
- [ ] Queue a short .mp4 video targeting the TikTok account
- [ ] Click **Run Now** on the dashboard
- [ ] Verify console logs show: token refresh → creator info → init post → upload → poll status → complete
- [ ] Verify the **Logs** page shows success with a post ID
- [ ] Check TikTok account for the posted video (may be private if app is unaudited)
- [ ] Verify token refresh works by waiting >1 hour and posting again

### YouTube

- [ ] Set `YOUTUBE_PROVIDER=official` in `.env`
- [ ] Set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in `.env`
- [ ] Enable YouTube Data API v3 in your Google Cloud project
- [ ] Create a YouTube account in **Dashboard → Accounts**
- [ ] Authorize via `http://localhost:3000/api/auth/youtube?accountId=YOUR_ACCOUNT_ID`
- [ ] Verify tokens are stored (check account details for accessToken / refreshToken)
- [ ] Queue a short vertical .mp4 video targeting the YouTube account
- [ ] Click **Run Now** on the dashboard
- [ ] Verify console logs show: token refresh → Shorts check → init resumable → upload → video ID
- [ ] Verify the **Logs** page shows success with a YouTube video URL
- [ ] Check YouTube Studio for the uploaded video (default: private)
- [ ] Verify the video title includes `#Shorts`
- [ ] Verify token refresh works by waiting >1 hour and posting again

### Cross-Platform

- [ ] Queue a single video targeting all three platforms at once
- [ ] Verify each target publishes independently (one failure doesn't block others)
- [ ] Verify partial failure triggers retry (check retryCount increments in queue)
- [ ] Verify `completed` status only after ALL targets succeed
- [ ] Verify `partially_posted` after max retries with mixed results
- [ ] Verify `failed` after max retries with all-fail
- [ ] Verify file auto-delete only occurs after full `completed` status
- [ ] Check **Logs** page for per-platform entries with correct platform tags
