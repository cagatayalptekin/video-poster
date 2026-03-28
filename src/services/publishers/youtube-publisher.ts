import { PlatformPublisher, PublishInput, PublishResult } from "./types";

/**
 * YouTube Shorts publisher.
 *
 * TODO: Implement real YouTube Data API v3 integration:
 * 1. Set up OAuth2 credentials in Google Cloud Console
 * 2. Use googleapis npm package
 * 3. Upload video via youtube.videos.insert with snippet.categoryId and #Shorts in title
 * 4. Handle token refresh via oauth2Client.refreshAccessToken()
 *
 * Reference: https://developers.google.com/youtube/v3/docs/videos/insert
 */
export class YoutubePublisher implements PlatformPublisher {
  platform = "youtube";

  async publishVideo(input: PublishInput): Promise<PublishResult> {
    // TODO: Replace with real YouTube API integration
    // For now, use mock behavior
    console.log(`[YoutubePublisher] Would upload ${input.filePath} to YouTube Shorts`);
    console.log(`[YoutubePublisher] Caption: ${input.caption}`);
    console.log(`[YoutubePublisher] Account: ${input.accountId}`);

    await new Promise((r) => setTimeout(r, 1500));

    const fakeId = `yt_${Date.now()}`;
    return {
      success: true,
      externalPostId: fakeId,
      externalUrl: `https://youtube.com/shorts/${fakeId}`,
    };
  }
}
