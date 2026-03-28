import { PlatformPublisher } from "./types";
import { YoutubePublisher } from "./youtube-publisher";
import { YouTubeApiPublisher } from "./youtube-api.publisher";
import { InstagramPublisher } from "./instagram-publisher";
import { InstagramPlaywrightPublisher } from "./instagram-playwright.publisher";
import { TikTokPublisher } from "./tiktok-publisher";
import { TikTokApiPublisher } from "./tiktok-api.publisher";

function createInstagramPublisher(): PlatformPublisher {
  const provider = process.env.INSTAGRAM_PROVIDER || "mock";
  if (provider === "playwright") {
    console.log("[Registry] Using Playwright Instagram publisher");
    return new InstagramPlaywrightPublisher();
  }
  console.log("[Registry] Using mock Instagram publisher");
  return new InstagramPublisher();
}

function createTikTokPublisher(): PlatformPublisher {
  const provider = process.env.TIKTOK_PROVIDER || "mock";
  if (provider === "official") {
    console.log("[Registry] Using official TikTok API publisher");
    return new TikTokApiPublisher();
  }
  console.log("[Registry] Using mock TikTok publisher");
  return new TikTokPublisher();
}

function createYouTubePublisher(): PlatformPublisher {
  const provider = process.env.YOUTUBE_PROVIDER || "mock";
  if (provider === "official") {
    console.log("[Registry] Using official YouTube API publisher");
    return new YouTubeApiPublisher();
  }
  console.log("[Registry] Using mock YouTube publisher");
  return new YoutubePublisher();
}

const publishers: Record<string, PlatformPublisher> = {
  youtube: createYouTubePublisher(),
  instagram: createInstagramPublisher(),
  tiktok: createTikTokPublisher(),
};

export function getPublisher(platform: string): PlatformPublisher {
  const publisher = publishers[platform];
  if (!publisher) {
    throw new Error(`No publisher registered for platform: ${platform}`);
  }
  return publisher;
}

export function getAvailablePlatforms(): string[] {
  return Object.keys(publishers);
}
