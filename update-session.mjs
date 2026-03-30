// Usage: node update-session.mjs <new_sessionid>
import { PrismaClient } from "@prisma/client";

const ACCOUNT_ID = "a763f848-3944-4612-92d3-48894d634c61";
const newSessionId = process.argv[2];

if (!newSessionId) {
  console.error("Usage: node update-session.mjs <new_sessionid>");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const account = await prisma.socialAccount.findUnique({ where: { id: ACCOUNT_ID } });
  if (!account) {
    console.error("Account not found:", ACCOUNT_ID);
    process.exit(1);
  }

  const metadata = JSON.parse(account.metadata || "{}");
  metadata.sessionid = newSessionId;

  await prisma.socialAccount.update({
    where: { id: ACCOUNT_ID },
    data: {
      accessToken: newSessionId,
      metadata: JSON.stringify(metadata),
    },
  });

  console.log("Session updated successfully!");
  console.log("New sessionid:", newSessionId.substring(0, 12) + "...");
}

main().catch(console.error).finally(() => prisma.$disconnect());
