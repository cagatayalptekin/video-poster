const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:ERSrLvFgRYQLaGFOkXnRoilsQwPIFmza@caboose.proxy.rlwy.net:49019/railway" } },
});

async function main() {
  // Reset the video with Post button error
  const items = await p.videoQueueItem.findMany({
    where: { status: "queued" },
    include: { targets: true },
  });
  for (const item of items) {
    console.log(`Video ${item.id}: file=${item.storedFilename}`);
    for (const t of item.targets) {
      if (t.status === "failed") {
        await p.videoPlatformTarget.update({
          where: { id: t.id },
          data: { status: "pending", errorMessage: null },
        });
        console.log(`  Reset target ${t.id} to pending`);
      }
    }
  }
}

main().catch(e => console.error(e)).finally(() => p.$disconnect());
