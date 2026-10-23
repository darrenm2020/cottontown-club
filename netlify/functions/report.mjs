import { getStore } from "@netlify/blobs";

// Problem reports sent automatically by the app (errors, failed saves). Admins see them on the club page.
// POST /api/report { msg, stack?, ver, team?, page?, dv? }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const cut = (s, n) => String(s ?? "").replace(/[\u0000-\u0008]/g, "").slice(0, n);

export async function handle(req, deps = {}) {
  if (req.method !== "POST") return json({ error: "bad request" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const msg = cut(b && b.msg, 300);
  if (!msg) return json({ error: "bad request" }, 400);
  const store = deps.store || getStore({ name: "cottontown", consistency: "strong" });
  const now = deps.now || Date.now();
  const key = "err-" + new Date(now).toISOString().slice(0, 10);
  const list = (await store.get(key, { type: "json" })) || [];
  const ver = cut(b.ver, 30), sig = msg + "|" + ver;
  const hit = list.find((x) => x.sig === sig);
  // The same problem from many phones becomes one entry with a count.
  if (hit) { hit.n++; hit.last = now; if (b.team && !hit.teams.includes(cut(b.team, 40)) && hit.teams.length < 10) hit.teams.push(cut(b.team, 40)); }
  else if (list.length < 300) list.push({ sig, msg, ver, stack: cut(b.stack, 1200), page: cut(b.page, 120), teams: b.team ? [cut(b.team, 40)] : [], n: 1, first: now, last: now, ua: cut(req.headers.get("user-agent"), 160) });
  else return json({ ok: true, dropped: true });
  await store.setJSON(key, list);
  return json({ ok: true });
}
export default (req) => handle(req);
export const config = { path: "/api/report" };
