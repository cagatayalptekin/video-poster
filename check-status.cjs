const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:ERSrLvFgRYQLaGFOkXnRoilsQwPIFmza@caboose.proxy.rlwy.net:49019/railway",
    },
  },
});

async function main() {
  const videos = await p.videoQueueItem.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { targets: true },
  });
  for (const v of videos) {
    console.log(`Video: ${v.originalFilename} | Status: ${v.status}`);
    for (const t of v.targets) {
      console.log(`  Target: ${t.platform} | Status: ${t.status} | Error: ${t.errorMessage || "none"}`);
    }
  }
}

main().catch(e => console.error(e)).finally(() => p.$disconnect());
