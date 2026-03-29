const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  const items = await prisma.videoQueueItem.findMany({ orderBy: { createdAt: "desc" }, take: 3, include: { targets: true } });
  for (const item of items) {
    console.log(`${item.originalFilename}: status=${item.status} retryCount=${item.retryCount}`);
    for (const t of item.targets) {
      console.log(`  -> ${t.platform}: ${t.status}`);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
