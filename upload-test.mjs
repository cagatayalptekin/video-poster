import fs from "fs";
import path from "path";

const BASE_URL = "https://video-poster-production.up.railway.app";
const VIDEO_PATH = "C:\\Users\\cagatay\\Downloads\\29.03.2026_13.26.45_REC.mp4";
const TIKTOK_ACCOUNT_ID = "a763f848-3944-4612-92d3-48894d634c61";

async function main() {
  // Login
  const loginResp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const cookies = loginResp.headers.getSetCookie();
  const adminCookie = cookies.find((c) => c.startsWith("admin_token="));
  const token = adminCookie.split(";")[0];
  console.log("Logged in:", token.substring(0, 30) + "...");

  // Upload video
  const videoBuffer = fs.readFileSync(VIDEO_PATH);
  const blob = new Blob([videoBuffer], { type: "video/mp4" });

  const formData = new FormData();
  formData.append("file", blob, "tiktok-test3.mp4");
  formData.append(
    "platforms",
    JSON.stringify([{ platform: "tiktok", accountIds: [TIKTOK_ACCOUNT_ID] }])
  );

  const uploadResp = await fetch(`${BASE_URL}/api/videos`, {
    method: "POST",
    headers: { Cookie: token },
    body: formData,
  });
  const result = await uploadResp.json();
  console.log("Upload result:", JSON.stringify(result, null, 2));

  if (result.id) {
    console.log(`\nVideo ID: ${result.id}`);
    console.log(`File: ${result.storedFilename}`);
    console.log(`Status: ${result.status}`);
  }
}

main().catch(console.error);
