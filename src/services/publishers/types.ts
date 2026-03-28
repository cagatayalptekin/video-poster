export interface PublishInput {
  filePath: string;
  caption: string;
  hashtags: string;
  accountId: string;
  accessToken?: string;
  refreshToken?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  success: boolean;
  externalPostId?: string;
  externalUrl?: string;
  errorMessage?: string;
}

export interface PlatformPublisher {
  platform: string;
  publishVideo(input: PublishInput): Promise<PublishResult>;
}
