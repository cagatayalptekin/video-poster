import fs from "fs";

const BASE_URL = "http://localhost:3000";
const VIDEO_PATH = "C:\\Users\\cagatay\\Downloads\\29.03.2026_13.26.45_REC.mp4";
const YOUTUBE_ACCOUNT_ID = "57b908c7-d6f3-4b52-a033-331a2fd47f19";

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
  formData.append("file", blob, "shorts-test.mp4");
  formData.append("caption", "Test Shorts Video");
  formData.append("hashtags", "#Shorts #test");
  formData.append(
    "platforms",
    JSON.stringify([{ platform: "youtube", accountIds: [YOUTUBE_ACCOUNT_ID] }])
  );

  const uploadResp = await fetch(`${BASE_URL}/api/videos`, {
    method: "POST",
    headers: { Cookie: token },
    body: formData,
  });
  const result = await uploadResp.json();
  console.log("Upload result:", JSON.stringify(result, null, 2));

  if (!result.id) {
    console.error("Upload failed!");
    return;
  }

  console.log(`\nVideo ID: ${result.id}`);
  console.log(`File: ${result.storedFilename}`);
  console.log(`Status: ${result.status}`);

  // Trigger scheduler
  console.log("\nTriggering scheduler...");
  const schedResp = await fetch(`${BASE_URL}/api/scheduler`, {
    method: "POST",
    headers: { Cookie: token },
  });
  const schedResult = await schedResp.json();
  console.log("Scheduler result:", JSON.stringify(schedResult, null, 2));

  // Wait and check status
  console.log("\nWaiting 10 seconds for processing...");
  await new Promise((r) => setTimeout(r, 10000));

  const statusResp = await fetch(`${BASE_URL}/api/videos/${result.id}`, {
    headers: { Cookie: token },
  });
  const statusResult = await statusResp.json();
  console.log("\nVideo status:", JSON.stringify(statusResult, null, 2));
}

main().catch(console.error);
