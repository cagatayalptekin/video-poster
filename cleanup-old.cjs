const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:ERSrLvFgRYQLaGFOkXnRoilsQwPIFmza@caboose.proxy.rlwy.net:49019/railway" } },
});

async function main() {
  // Mark the old video with missing file as failed permanently
  const oldVideo = await p.videoQueueItem.findFirst({
    where: { storedFilename: "56d4dc87-5333-42c4-b4cc-8238a999f5f0.mp4" },
  });
  if (oldVideo) {
    await p.videoQueueItem.update({
      where: { id: oldVideo.id },
      data: { status: "failed", errorMessage: "File lost during redeployment" },
    });
    await p.videoPlatformTarget.updateMany({
      where: { videoQueueItemId: oldVideo.id },
      data: { status: "failed", errorMessage: "File lost during redeployment" },
    });
    console.log(`Marked old video ${oldVideo.id} as permanently failed`);
  }
}

main().catch(e => console.error(e)).finally(() => p.$disconnect());
