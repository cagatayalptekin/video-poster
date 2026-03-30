import { PrismaClient } from "@prisma/client";

const ACCOUNT_ID = "a763f848-3944-4612-92d3-48894d634c61";
const prisma = new PrismaClient();

async function main() {
  const account = await prisma.socialAccount.findUnique({ where: { id: ACCOUNT_ID } });
  const meta = JSON.parse(account.metadata || "{}");
  meta.tiktokEmail = "puffhidetr";
  meta.tiktokPassword = "Cagatayalp4!";
  await prisma.socialAccount.update({
    where: { id: ACCOUNT_ID },
    data: { metadata: JSON.stringify(meta) },
  });
  console.log("Credentials saved to metadata");
}

main().catch(console.error).finally(() => prisma.$disconnect());
