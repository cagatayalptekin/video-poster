import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create admin user
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.adminUser.upsert({
    where: { username },
    update: {},
    create: { username, password: hashedPassword },
  });
  console.log(`Admin user created: ${username}`);

  // Seed default settings
  const defaults = [
    { key: "posting_interval_hours", value: "24" },
    { key: "auto_delete_after_success", value: "true" },
    { key: "max_retry_count", value: "3" },
    { key: "app_timezone", value: "UTC" },
    { key: "default_caption_suffix", value: "" },
  ];

  for (const setting of defaults) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }
  console.log("Default settings created");

  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
