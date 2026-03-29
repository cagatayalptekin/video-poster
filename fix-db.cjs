const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  // Mark old item as failed (file no longer exists)
  const r = await prisma.videoQueueItem.update({ where: { id: "2a2faa7c-22cf-482a-b6f1-5b88d08401f2" }, data: { status: "failed", errorMessage: "Video file missing after redeploy" } });
  console.log("Old item marked failed:", r.status);
}
main().catch(console.error).finally(() => prisma.$disconnect());
