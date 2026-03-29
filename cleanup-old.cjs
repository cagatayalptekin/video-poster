const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:ERSrLvFgRYQLaGFOkXnRoilsQwPIFmza@caboose.proxy.rlwy.net:49019/railway" } },
});

async function main() {
  // Mark all non-completed videos as failed so we can start fresh
  const items = await p.videoQueueItem.findMany({
    where: { status: { not: "completed" } },
    include: { targets: true },
  });
  for (const item of items) {
    await p.videoQueueItem.update({
      where: { id: item.id },
      data: { status: "failed", errorMessage: "Cleaned up for fresh retry" },
    });
    await p.videoPlatformTarget.updateMany({
      where: { videoQueueItemId: item.id },
      data: { status: "failed", errorMessage: "Cleaned up for fresh retry" },
    });
    console.log(`Marked ${item.id} (${item.originalFilename}) as failed`);
  }
}

main().catch(e => console.error(e)).finally(() => p.$disconnect());
