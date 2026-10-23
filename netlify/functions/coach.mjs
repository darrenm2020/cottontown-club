import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { COMMITTEE, CHAIR, MEMBER_IDS, askSystem, playSystem, ASK_SCHEMA, PLAY_SCHEMA, cleanAsk, cleanPlay } from "../lib/committee.mjs";

// AI help for coaches: the "Coach the Coach" committee and the coaching board's play drawer.
// GET  /api/coach?committee=1                       -> the committee (names, emojis, strengths)
// POST /api/coach { team, code, mode:'ask', question, members?, history? }   -> committee answers + a session plan
// POST /api/coach { team, code, mode:'play', question, history? }            -> a play for the coaching board
// Coaches only (team code or main code). Each team gets AI_MONTHLY_LIMIT questions a month (default 150).
// Model: COACH_MODEL (default claude-opus-5-5). Key: ANTHROPIC_API_KEY, or Netlify's AI Gateway supplies one.

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
  const base = {
    model: env("COACH_MODEL") || "claude-opus-5-5",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    // Committee answers are conversational; drawing a play takes more spatial reasoning.
    output_config: { effort: mode === "play" ? "medium" : "low", format: { type: "json_schema", schema: mode === "play" ? PLAY_SCHEMA : ASK_SCHEMA } },
    system: mode === "play" ? playSystem(ctx) : askSystem(ctx),
    messages: [...historyMessages(b.history), { role: "user", content }],
  };
  const client = deps.client || new Anthropic({ timeout: 50000, maxRetries: 0 });

  let msg;
  try {
    try {
      // Server-side fallback: if a request is declined, Anthropic re-runs it on its recommended model.
      msg = await client.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      // Netlify's AI Gateway can't pass beta headers through; ask again without the fallback.
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      msg = await client.messages.create(base);
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The AI isn't set up yet (no API key in Netlify)." }, 503);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The AI is busy. Try again in a minute." }, 429);
    if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError) return json({ error: "The AI model isn't available. Check COACH_MODEL in Netlify." }, 502);
    if (e instanceof Anthropic.APIConnectionTimeoutError) return json({ error: "The AI took too long. Try a shorter question." }, 504);
    if (e instanceof Anthropic.APIError) return json({ error: "The AI had a problem. Try again." }, 502);
    throw e;
  }
  if (msg.stop_reason === "refusal") return json({ error: "The committee can't help with that one. Try asking it another way." }, 422);
  if (msg.stop_reason === "max_tokens") return json({ error: "That answer ran too long. Try a narrower question." }, 502);
  const text = msg.content.filter((x) => x.type === "text").map((x) => x.text).join("");
  let parsed;
  try { parsed = JSON.parse(text); } catch { return json({ error: "The AI's answer came back garbled. Try again." }, 502); }
  const result = mode === "play" ? cleanPlay(parsed) : cleanAsk(parsed);
  if (mode === "play" && !result.steps.length) return json({ error: "The AI couldn't draw that play. Try describing it differently." }, 502);

  await store.setJSON(ukey, { n: used.n + 1, at: Date.now() });
  return json({ ok: true, mode, result, raw: text, left: limit - used.n - 1 });
}

export default (req) => handle(req);
export const config = { path: "/api/coach" };
