import prisma from "./prisma";

const DEFAULTS: Record<string, string> = {
  posting_interval_hours: "24",
  auto_delete_after_success: "true",
  max_retry_count: "3",
  app_timezone: "UTC",
  default_caption_suffix: "",
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key] ?? "";
}

export async function getSettingNumber(key: string): Promise<number> {
  const val = await getSetting(key);
  return Number(val) || 0;
}

export async function getSettingBool(key: string): Promise<boolean> {
  const val = await getSetting(key);
  return val === "true" || val === "1";
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.appSetting.findMany();
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
