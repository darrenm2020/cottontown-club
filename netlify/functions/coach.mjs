import { askJSON, newClient } from "../lib/ai.mjs";
import { getStore } from "@netlify/blobs";
import { COMMITTEE, CHAIR, MEMBER_IDS, askSystem, playSystem, ASK_SCHEMA, PLAY_SCHEMA, cleanAsk, cleanPlay } from "../lib/committee.mjs";

// AI help for coaches: the "Coach the Coach" committee and the coaching board's play drawer.
// GET  /api/coach?committee=1                       -> the committee (names, emojis, strengths)
// POST /api/coach { team, code, mode:'ask', question, members?, history? }   -> committee answers + a session plan
// POST /api/coach { team, code, mode:'play', question, history? }            -> a play for the coaching board
// Coaches only (team code or main code). Each team gets AI_MONTHLY_LIMIT questions a month (default 150).

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "").trim();
const okId = (s) => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s);

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tracker:" + s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function isCoach(store, team, code) {
  code = String(code ?? "").trim();
  if (!code) return false;
  const m = env("COACH_CODE");
  if (m && code === m) return true;
  const a = await store.get("auth-" + team, { type: "json" });
  return !!(a && a.hash && a.hash === (await sha(code)));
}

// Earlier turns go back to the model so a coach can ask follow-ups ("make it shorter", "for U9").
function historyMessages(history) {
  const out = [];
  for (const h of (Array.isArray(history) ? history : []).slice(-4)) {
    const q = String((h && h.q) || "").slice(0, 2000);
    const a = h && h.a ? (typeof h.a === "string" ? h.a : JSON.stringify(h.a)).slice(0, 12000) : "";
    if (q && a) out.push({ role: "user", content: q }, { role: "assistant", content: a });
  }
  return out;
}

export async function handle(req, deps = {}) {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("committee")) return json({ members: COMMITTEE.map(({ id, name, emoji, school, strengths }) => ({ id, name, emoji, school, strengths })), chair: CHAIR });
    return json({ error: "bad request" }, 400);
  }
  if (req.method !== "POST") return json({ error: "bad request" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const team = b && b.team;
  const mode = b && b.mode === "play" ? "play" : "ask";
  const question = String((b && b.question) || "").trim().slice(0, 2000);
  if (!okId(team) || !question) return json({ error: "bad request" }, 400);

  const store = deps.store || getStore({ name: "cottontown", consistency: "strong" });
  if (!(await isCoach(store, team, b.code))) return json({ error: "Coaches only. Unlock with your coach code." }, 401);

  const month = new Date().toISOString().slice(0, 7);
  const ukey = "ai-usage-" + team + "-" + month;
  const used = (await store.get(ukey, { type: "json" })) || { n: 0 };
  const limit = Number(env("AI_MONTHLY_LIMIT")) || 150;
  if (used.n >= limit) return json({ error: `This team has used its ${limit} AI questions for this month.` }, 429);

  const cfg = await store.get("team-" + team, { type: "json" });
  const c = (cfg && cfg.team) || {};
  const ctx = { team: c.name || team, sub: c.sub || "", format: c.format || "", formation: c.formation || "",
    players: Array.isArray(c.players) ? c.players.length : 0, positions: String(b.positions || "").slice(0, 200) };

  let content = question;
  if (mode === "ask" && Array.isArray(b.members)) {
    const pick = b.members.filter((m) => MEMBER_IDS.includes(m)).slice(0, 4);
    if (pick.length) content += `\n\n(The coach asked to hear from: ${pick.join(", ")}.)`;
  }
  // Committee answers are conversational; drawing a play takes more spatial reasoning.
  const r = await askJSON(deps.client || newClient(), {
    system: mode === "play" ? playSystem(ctx) : askSystem(ctx),
    messages: [...historyMessages(b.history), { role: "user", content }],
    schema: mode === "play" ? PLAY_SCHEMA : ASK_SCHEMA,
    effort: mode === "play" ? "medium" : "low",
  });
  if (r.error) return json({ error: r.error.replace("The AI can't help", "The committee can't help") }, r.status);
  const parsed = r.data, text = r.text;
  const result = mode === "play" ? cleanPlay(parsed) : cleanAsk(parsed);
  if (mode === "play" && !result.steps.length) return json({ error: "The AI couldn't draw that play. Try describing it differently." }, 502);

  await store.setJSON(ukey, { n: used.n + 1, at: Date.now() });
  return json({ ok: true, mode, result, raw: text, left: limit - used.n - 1 });
}

export default (req) => handle(req);
export const config = { path: "/api/coach" };
