const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  await prisma.videoQueueItem.updateMany({ where: { status: "queued" }, data: { status: "failed", errorMessage: "File lost on redeploy" } });
  console.log("Done");
}
main().catch(console.error).finally(() => prisma.$disconnect());
