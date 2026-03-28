import { PlatformPublisher, PublishInput, PublishResult } from "./types";

/**
 * Instagram Reels publisher.
 *
 * TODO: Implement real Instagram Graph API integration:
 * 1. Set up Facebook Developer App with Instagram permissions
 * 2. Use ig_user_id and access_token from account metadata
 * 3. POST to /ig_user_id/media with media_type=REELS, video_url, caption
 * 4. Poll for upload status, then POST to /ig_user_id/media_publish
 *
 * Reference: https://developers.facebook.com/docs/instagram-api/guides/reels-publishing
 */
export class InstagramPublisher implements PlatformPublisher {
  platform = "instagram";

  async publishVideo(input: PublishInput): Promise<PublishResult> {
    // TODO: Replace with real Instagram Graph API integration
    console.log(`[InstagramPublisher] Would upload ${input.filePath} to Instagram Reels`);
    console.log(`[InstagramPublisher] Caption: ${input.caption}`);
    console.log(`[InstagramPublisher] Account: ${input.accountId}`);

    await new Promise((r) => setTimeout(r, 1500));

    const fakeId = `ig_${Date.now()}`;
    return {
      success: true,
      externalPostId: fakeId,
      externalUrl: `https://instagram.com/reel/${fakeId}`,
    };
  }
}
