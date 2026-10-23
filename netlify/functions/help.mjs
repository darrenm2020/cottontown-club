import { getStore } from "@netlify/blobs";
import { askJSON, newClient } from "../lib/ai.mjs";
import { HELP_DOC } from "../lib/help-doc.mjs";
import { whoami, allMembers, getMember } from "../lib/members.mjs";
import * as M from "../lib/messages.mjs";

// The in-app help desk: anyone (parents too) can ask how to do something. Claude answers from the user guide.
// When it can't solve the problem, the person sends it to the club admins as a help request.
// POST /api/help { kind:'ask', question, history?, ctx:{role,page,team,tab,ver}, dv }
// POST /api/help { kind:'ticket', text, contact?, ctx, dv }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "").trim();
const cut = (s, n) => String(s ?? "").replace(/[\u0000-\u0008]/g, "").trim().slice(0, n);
const okDv = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(s);

const SCHEMA = { type: "object", additionalProperties: false, required: ["answer", "escalate"],
  properties: { answer: { type: "string" }, escalate: { type: "boolean" } } };

function system(ctx) {
  return `You are the help desk inside a youth soccer team app. Answer questions about using the app from the user guide below.
- Be brief and friendly: 2 to 6 short sentences or a few numbered steps. Name the exact buttons and tabs.
- The person is a ${ctx.role || "visitor"}. Coach-only steps should say a coach needs to do them if the person is a parent.
- If the guide doesn't cover it, or something looks broken (data missing that restore can't fix, errors, payments not matching, anything about money owed or refunds), or it's about safety, a child's welfare, or inappropriate messages, set escalate to true and say a club admin will help; tell them to tap "Send to the club admins".
- Never make up features. Never ask for passwords, coach codes or payment details.

Where they are: page ${ctx.page || "unknown"}${ctx.team ? ", team " + ctx.team : ""}${ctx.tab ? ", tab " + ctx.tab : ""}. App version ${ctx.ver || "unknown"}.

${HELP_DOC}`;
}
function cleanCtx(c) { c = c || {}; return { role: ["parent", "coach", "admin", "visitor"].includes(c.role) ? c.role : "visitor", page: cut(c.page, 40), team: cut(c.team, 60), tab: cut(c.tab, 20), ver: cut(c.ver, 30) }; }

export async function handle(req, deps = {}) {
  if (req.method !== "POST") return json({ error: "bad request" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!b || !okDv(b.dv)) return json({ error: "bad request" }, 400);
  const store = deps.store || getStore({ name: "cottontown", consistency: "strong" });
  const ctx = cleanCtx(b.ctx);
  const day = new Date().toISOString().slice(0, 10);

  if (b.kind === "ticket") {
    const text = cut(b.text, 2000);
    if (!text) return json({ error: "Tell us what's going on" }, 400);
    const me = await whoami(store, req);
    const tickets = (await store.get("tickets", { type: "json" })) || [];
    if (tickets.filter((t) => t.dv === b.dv && t.at > Date.now() - 864e5).length >= 5) return json({ error: "You've sent several requests today. A club admin will get back to you." }, 429);
    const t = { id: "k" + Date.now().toString(36), at: Date.now(), dv: b.dv, from: me ? me.name : "", member: me ? me.id : "", contact: cut(b.contact, 120), text, ctx, transcript: cut(b.transcript, 4000), done: false };
    tickets.push(t);
    await store.setJSON("tickets", tickets.slice(-300));
    // Members' requests also arrive as a direct message to each club admin.
    let messaged = 0;
    if (me) {
      const idx = await allMembers(store);
      for (const a of idx.filter((x) => x.role === "admin" && x.id !== me.id)) {
        const adm = await getMember(store, a.id);
        const r = await M.send(store, me, M.dmId(me.id, a.id), `Help request: ${text}${ctx.team ? `\n(Team: ${ctx.team}, ${ctx.tab || ctx.page})` : ""}`, { origin: new URL(req.url).origin });
        if (!r.error && adm) messaged++;
      }
    }
    return json({ ok: true, id: t.id, messaged });
  }

  const question = cut(b.question, 1000);
  if (!question) return json({ error: "Ask a question" }, 400);
  const uk = "help-" + day;
  const use = (await store.get(uk, { type: "json" })) || { n: 0, dv: {} };
  const perDevice = 30, daily = Number(env("HELP_DAILY_LIMIT")) || 400;
  if ((use.dv[b.dv] || 0) >= perDevice || use.n >= daily) return json({ error: "The help desk is resting for today. Tap “Send to the club admins” and a person will help." }, 429);
  const history = (Array.isArray(b.history) ? b.history : []).slice(-3).flatMap((h) => (h && h.q && h.a ? [{ role: "user", content: cut(h.q, 1000) }, { role: "assistant", content: JSON.stringify({ answer: cut(h.a, 3000), escalate: false }) }] : []));
  const r = await askJSON(deps.client || newClient(), { system: system(ctx), messages: [...history, { role: "user", content: question }], schema: SCHEMA, effort: "low", maxTokens: 4000 });
  if (r.error) return json({ error: r.error, escalate: true }, r.status);
  use.n++; use.dv[b.dv] = (use.dv[b.dv] || 0) + 1;
  await store.setJSON(uk, use);
  return json({ ok: true, answer: cut(r.data.answer, 3000), escalate: !!r.data.escalate });
}
export default (req) => handle(req);
export const config = { path: "/api/help" };
