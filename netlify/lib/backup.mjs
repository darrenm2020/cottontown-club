// Daily backups of everything the club has saved, kept for 30 days in a separate store.
// Undo history, AI usage counters and problem reports are left out; PayPal secrets are blanked.
const SKIP = ["hist-", "ai-usage-", "help-", "err-", "tok-"];
export const backupStore = (getStore) => getStore({ name: "cottontown-backups", consistency: "strong" });

export async function runBackup(store, bstore, now = Date.now()) {
  const { blobs } = await store.list();
  const keys = blobs.map((b) => b.key).filter((k) => !SKIP.some((p) => k.startsWith(p)));
  const data = {};
  for (let i = 0; i < keys.length; i += 25) {
    const part = keys.slice(i, i + 25);
    const vals = await Promise.all(part.map((k) => store.get(k, { type: "json" }).catch(() => null)));
    part.forEach((k, j) => { if (vals[j] != null) data[k] = vals[j]; });
  }
  for (const k of Object.keys(data)) if (k.startsWith("payee-") && data[k].paypal) data[k] = { ...data[k], paypal: { ...data[k].paypal, secret: "" } };
  const day = new Date(now).toISOString().slice(0, 10);
  await bstore.setJSON(day, { at: now, count: Object.keys(data).length, data });
  // Keep 30 days.
  const cutoff = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
  const { blobs: old } = await bstore.list();
  for (const b of old) if (b.key < cutoff) await bstore.delete(b.key);
  return { day, count: Object.keys(data).length };
}
export async function listBackups(bstore) {
  const { blobs } = await bstore.list();
  return blobs.map((b) => b.key).sort().reverse();
}
