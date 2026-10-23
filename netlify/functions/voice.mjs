import { getStore } from "@netlify/blobs";
import { askJSON, newClient } from "../lib/ai.mjs";
import { codeLevel } from "../lib/members.mjs";
import * as V from "../lib/voice.mjs";

// Voice plan changes: POST /api/voice { team, code, kind: 'game' | 'practice', request, ctx }
// Returns the changed plan for the coach to approve; nothing is saved here. Coaches only.
// Counts toward the team's monthly AI limit (AI_MONTHLY_LIMIT, shared with Coach the Coach).
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "").trim();

export async function handle(req, deps = {}) {
  if (req.method !== "POST") return json({ error: "bad request" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const request = String((b && b.request) || "").trim().slice(0, 1500);
  if (!b || !request || !["game", "practice"].includes(b.kind)) return json({ error: "Say what you'd like to change" }, 400);
  const store = deps.store || getStore({ name: "cottontown", consistency: "strong" });
  if (!(await codeLevel(store, b.team, b.code))) return json({ error: "Coaches only. Unlock with your coach code." }, 401);

  const ukey = "ai-usage-" + b.team + "-" + new Date().toISOString().slice(0, 7);
  const used = (await store.get(ukey, { type: "json" })) || { n: 0 };
  const limit = Number(env("AI_MONTHLY_LIMIT")) || 150;
  if (used.n >= limit) return json({ error: `This team has used its ${limit} AI requests for this month.` }, 429);

  const game = b.kind === "game";
  const ctx = game ? V.cleanGameCtx(b.ctx) : V.cleanPracticeCtx(b.ctx);
  if (game && (!ctx.positions.length || !ctx.players.length || !ctx.blocks.length)) return json({ error: "There's no plan to change yet." }, 400);
  const r = await askJSON(deps.client || newClient(), {
    system: game ? V.gameSystem(ctx) : V.practiceSystem(ctx),
    messages: [{ role: "user", content: request }],
    schema: game ? V.gameSchema(ctx) : V.practiceSchema(ctx),
    effort: "medium",
  });
  if (r.error) return json({ error: r.error }, r.status);
  await store.setJSON(ukey, { n: used.n + 1, at: Date.now() });
  const d = r.data;
  if (!d.possible) return json({ ok: true, possible: false, message: String(d.message || "I couldn't make that change.").slice(0, 400), left: limit - used.n - 1 });
  const plan = game ? V.checkGamePlan(ctx, d) : V.checkPracticePlan(ctx, d);
  if (plan.error) return json({ error: plan.error }, 502);
  return json({ ok: true, possible: true, message: String(d.message || "").slice(0, 400), changes: (d.changes || []).slice(0, 20).map((x) => String(x).slice(0, 200)), plan, left: limit - used.n - 1 });
}
export default (req) => handle(req);
export const config = { path: "/api/voice" };
