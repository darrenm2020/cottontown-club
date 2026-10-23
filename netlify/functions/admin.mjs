import { getStore } from "@netlify/blobs";
import { runBackup, listBackups, backupStore } from "../lib/backup.mjs";

// Club admin tools (main coach code only): backups, problem reports and help requests.
// POST /api/admin { code, kind: backups | backup(day) | backupnow | problems(day?) | tickets | ticket(id, done) }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "").trim();

export async function handle(req, deps = {}) {
  if (req.method !== "POST") return json({ error: "bad request" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const m = env("COACH_CODE");
  if (!m || String((b && b.code) || "").trim() !== m) return json({ error: "Main coach code needed" }, 401);
  const store = deps.store || getStore({ name: "cottontown", consistency: "strong" });
  const bstore = deps.bstore || backupStore(getStore);
  const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : null);
  switch (b.kind) {
    case "backups": return json({ ok: true, days: await listBackups(bstore) });
    case "backupnow": return json({ ok: true, ...(await runBackup(store, bstore)) });
    case "backup": {
      const d = day(b.day); const v = d && (await bstore.get(d, { type: "json" }));
      if (!v) return json({ error: "No backup for that day" }, 404);
      return new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="club-backup-${d}.json"` } });
    }
    case "problems": {
      const days = [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
      const lists = await Promise.all(days.map((d) => store.get("err-" + d, { type: "json" })));
      const all = lists.flatMap((l, i) => (l || []).map((x) => ({ ...x, day: days[i] })));
      return json({ ok: true, problems: all.sort((a, b2) => b2.last - a.last).slice(0, 100) });
    }
    case "tickets": return json({ ok: true, tickets: ((await store.get("tickets", { type: "json" })) || []).slice().reverse() });
    case "ticket": {
      const list = (await store.get("tickets", { type: "json" })) || [];
      const t = list.find((x) => x.id === b.id);
      if (!t) return json({ error: "not found" }, 404);
      t.done = !!b.done; await store.setJSON("tickets", list);
      return json({ ok: true });
    }
  }
  return json({ error: "bad request" }, 400);
}
export default (req) => handle(req);
export const config = { path: "/api/admin" };
