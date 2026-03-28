import prisma from "../lib/prisma";
import { log } from "../lib/logger";
import { getSetting, getSettingBool } from "../lib/settings";
import { getPublisher } from "./publishers/registry";
import fs from "fs";
import path from "path";

let isProcessing = false;

export async function processNextInQueue(): Promise<void> {
  if (isProcessing) {
    await log({ level: "warn", context: "scheduler", message: "Queue processor already running, skipping" });
    return;
  }
  isProcessing = true;

  try {
    // Pick the next queued video (FIFO by createdAt)
    const item = await prisma.videoQueueItem.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      include: { targets: { include: { socialAccount: true } } },
    });

    if (!item) {
      await log({ level: "info", context: "scheduler", message: "No queued videos to process" });
      return;
    }

    await log({
      level: "info",
      context: "scheduler",
      message: `Processing video: ${item.originalFilename}`,
      videoQueueItemId: item.id,
    });

    // Mark as processing
    await prisma.videoQueueItem.update({
      where: { id: item.id },
      data: { status: "processing", processedAt: new Date() },
    });

    let allSuccess = true;
    let anySuccess = false;

    for (const target of item.targets) {
      if (target.status === "success") {
        anySuccess = true;
        continue; // Skip already-posted targets (for retries)
      }

      try {
        // Mark target as posting
        await prisma.videoPlatformTarget.update({
          where: { id: target.id },
          data: { status: "posting" },
        });

        const publisher = getPublisher(target.platform);
        const result = await publisher.publishVideo({
          filePath: item.filePath,
          caption: `${item.caption || ""}${item.hashtags ? " " + item.hashtags : ""}`,
          hashtags: item.hashtags || "",
          accountId: target.socialAccountId,
          accessToken: target.socialAccount.accessToken || undefined,
          refreshToken: target.socialAccount.refreshToken || undefined,
          metadata: target.socialAccount.metadata ? JSON.parse(target.socialAccount.metadata) : undefined,
        });

        if (result.success) {
          await prisma.videoPlatformTarget.update({
            where: { id: target.id },
            data: {
              status: "success",
              externalPostId: result.externalPostId,
              externalUrl: result.externalUrl,
            },
          });
          anySuccess = true;
          await log({
            level: "success",
            context: "publish",
            message: `Published to ${target.platform} via ${target.socialAccount.accountName}`,
            platform: target.platform,
            socialAccountId: target.socialAccountId,
            videoQueueItemId: item.id,
            details: { externalPostId: result.externalPostId, externalUrl: result.externalUrl },
          });
        } else {
          allSuccess = false;
          await prisma.videoPlatformTarget.update({
            where: { id: target.id },
            data: { status: "failed", errorMessage: result.errorMessage },
          });
          await log({
            level: "error",
            context: "publish",
            message: `Failed to publish to ${target.platform}: ${result.errorMessage}`,
            platform: target.platform,
            socialAccountId: target.socialAccountId,
            videoQueueItemId: item.id,
          });
        }
      } catch (err) {
        allSuccess = false;
        const errMsg = err instanceof Error ? err.message : String(err);
        await prisma.videoPlatformTarget.update({
          where: { id: target.id },
          data: { status: "failed", errorMessage: errMsg },
        });
        await log({
          level: "error",
          context: "publish",
          message: `Exception publishing to ${target.platform}: ${errMsg}`,
          platform: target.platform,
          socialAccountId: target.socialAccountId,
          videoQueueItemId: item.id,
        });
      }
    }

    const maxRetries = Number(await getSetting("max_retry_count")) || 3;

    if (allSuccess) {
      await prisma.videoQueueItem.update({
        where: { id: item.id },
        data: { status: "completed" },
      });

      // Delete local file if setting enabled
      const autoDelete = await getSettingBool("auto_delete_after_success");
      if (autoDelete) {
        try {
          const fullPath = path.resolve(item.filePath);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            await log({
              level: "info",
              context: "cleanup",
              message: `Deleted local file: ${item.originalFilename}`,
              videoQueueItemId: item.id,
            });
          }
        } catch (err) {
          await log({
            level: "warn",
            context: "cleanup",
            message: `Failed to delete file: ${err instanceof Error ? err.message : String(err)}`,
            videoQueueItemId: item.id,
          });
        }
      }

      await log({
        level: "success",
        context: "scheduler",
        message: `Video completed: ${item.originalFilename}`,
        videoQueueItemId: item.id,
      });
    } else if (anySuccess) {
      if (item.retryCount >= maxRetries) {
        await prisma.videoQueueItem.update({
          where: { id: item.id },
          data: { status: "partially_posted", retryCount: item.retryCount + 1 },
        });
      } else {
        // Re-queue for retry
        await prisma.videoQueueItem.update({
          where: { id: item.id },
          data: { status: "queued", retryCount: item.retryCount + 1 },
        });
      }
    } else {
      if (item.retryCount >= maxRetries) {
        await prisma.videoQueueItem.update({
          where: { id: item.id },
          data: {
            status: "failed",
            retryCount: item.retryCount + 1,
            errorMessage: "Max retries exceeded",
          },
        });
      } else {
        await prisma.videoQueueItem.update({
          where: { id: item.id },
          data: { status: "queued", retryCount: item.retryCount + 1 },
        });
      }
    }
  } catch (err) {
    await log({
      level: "error",
      context: "scheduler",
      message: `Queue processing error: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    isProcessing = false;
  }
}
