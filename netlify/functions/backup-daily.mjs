import { getStore } from "@netlify/blobs";
import { runBackup, backupStore } from "../lib/backup.mjs";

// Runs once a day and saves a copy of all club data (kept 30 days). Admins download copies from the club page.
export default async () => {
  const r = await runBackup(getStore({ name: "cottontown", consistency: "strong" }), backupStore(getStore));
  console.log("backup", r.day, r.count, "items");
};
export const config = { schedule: "@daily" };
