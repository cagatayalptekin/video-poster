import { PlatformPublisher, PublishInput, PublishResult } from "./types";

/**
 * TikTok publisher.
 *
 * TODO: Implement real TikTok Content Posting API:
 * 1. Register app at https://developers.tiktok.com
 * 2. Use OAuth to get access_token
 * 3. POST /v2/post/publish/video/init/ to initiate upload
 * 4. Upload video chunks to the provided upload_url
 * 5. Poll for publish status
 *
 * Reference: https://developers.tiktok.com/doc/content-posting-api-get-started
 */
export class TikTokPublisher implements PlatformPublisher {
  platform = "tiktok";

  async publishVideo(input: PublishInput): Promise<PublishResult> {
    // TODO: Replace with real TikTok Content Posting API integration
    console.log(`[TikTokPublisher] Would upload ${input.filePath} to TikTok`);
    console.log(`[TikTokPublisher] Caption: ${input.caption}`);
    console.log(`[TikTokPublisher] Account: ${input.accountId}`);

    await new Promise((r) => setTimeout(r, 1500));

    const fakeId = `tt_${Date.now()}`;
    return {
      success: true,
      externalPostId: fakeId,
      externalUrl: `https://tiktok.com/@user/video/${fakeId}`,
    };
  }
}
