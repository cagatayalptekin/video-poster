import { PlatformPublisher, PublishInput, PublishResult } from "./types";

/**
 * Mock publisher for development/testing.
 * Simulates a successful post with a random delay.
 */
export class MockPublisher implements PlatformPublisher {
  constructor(public platform: string) {}

  async publishVideo(input: PublishInput): Promise<PublishResult> {
    // Simulate network delay
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));

    // 90% success rate for testing
    const success = Math.random() > 0.1;

    if (success) {
      const fakeId = `mock_${this.platform}_${Date.now()}`;
      return {
        success: true,
        externalPostId: fakeId,
        externalUrl: `https://${this.platform}.example.com/post/${fakeId}`,
      };
    }
    return {
      success: false,
      errorMessage: `Mock ${this.platform} publish failed (simulated error)`,
    };
  }
}
