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
    take: 5,
    include: { targets: true },
  });
  console.log(`Found ${videos.length} videos`);
  for (const v of videos) {
    console.log(`Video: ${v.originalFilename} | Status: ${v.status} | Error: ${v.errorMessage || "none"}`);
    for (const t of v.targets) {
      console.log(`  Target: ${t.platform} | Status: ${t.status} | PostId: ${t.externalPostId || "none"} | URL: ${t.externalUrl || "none"} | Error: ${t.errorMessage || "none"}`);
    }
  }
}

main().catch(e => console.error(e)).finally(() => p.$disconnect());
