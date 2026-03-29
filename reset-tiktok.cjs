const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:ERSrLvFgRYQLaGFOkXnRoilsQwPIFmza@caboose.proxy.rlwy.net:49019/railway",
    },
  },
});

async function main() {
  // Reset the failed TikTok target and its parent video to queued
  const failedTargets = await p.videoPlatformTarget.findMany({
    where: { platform: "tiktok", status: "failed" },
    include: { videoQueueItem: true },
  });

  for (const t of failedTargets) {
    await p.videoPlatformTarget.update({
      where: { id: t.id },
      data: { status: "pending", errorMessage: null },
    });
    await p.videoQueueItem.update({
      where: { id: t.videoQueueItemId },
      data: { status: "queued", errorMessage: null },
    });
    console.log(`Reset target ${t.id} and video ${t.videoQueueItemId} to queued/pending`);
  }
}

main().catch(e => console.error(e)).finally(() => p.$disconnect());
