import { getStore } from "@netlify/blobs";
import { whoami, joinWithCode, joinWithInvite, createInvite, readInvite, pub, saveMember, allMembers, cleanName, roster, link, removeFromTeam, setRole, removeMember, listMembers, myKid } from "../lib/members.mjs";
import * as M from "../lib/messages.mjs";
import * as F from "../lib/fees.mjs";
import * as P from "../lib/push.mjs";

// Club members, messages and fees.
// GET  /api/club?invite=CODE           -> team and players for a parent's join link (no sign-in)
// GET  /api/club?me=1 | inbox=1 | ch=CHANNEL[&since=ID] | people=1 | fees=1 | csv=FEE_ID   (Authorization: Bearer TOKEN)
// POST /api/club { kind: join | profile | invite | send | del | pin | read | fee | feearchive | pay | payee | ppcreate | ppcapture, ... }

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const out = (r) => (r && r.error ? json({ error: r.error }, r.status || 400) : json({ ok: true, ...r }));
async function teamNames(store) {
  const idx = (await store.get("teams", { type: "json" })) || [];
  return Object.fromEntries(idx.map((t) => [t.id, t.name]));
}

export async function handle(req, deps = {}) {
  const store = deps.store || getStore({ name: "cottontown", consistency: "strong" });
  const f = deps.fetch || fetch;
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);
  const me = await whoami(store, req);

  if (req.method === "GET") {
    if (q("invite")) { const inv = await readInvite(store, q("invite")); return inv ? json(inv) : json({ error: "This invite link has expired. Ask your coach for a new one." }, 404); }
    if (!me) return json({ error: "Join the club first" }, 401);
    if (q("me")) { const ib = await M.inbox(store, me, await teamNames(store)); return json({ me: pub(me), unread: ib.filter((x) => x.unread).length }); }
    if (q("inbox")) return json({ channels: await M.inbox(store, me, await teamNames(store)) });
    if (q("roster")) return out(await roster(store, me, q("roster")));
    if (q("members")) return out(await listMembers(store, me));
    if (q("push")) { const v = await P.vapid(store); return json({ publicKey: v.publicKey, ...(await P.getPrefs(store, me)) }); }
    if (q("ch")) return out(await M.list(store, me, q("ch"), q("since") || ""));
    if (q("people")) {
      const all = await allMembers(store);
      const full = await Promise.all(all.map((m) => store.get("mem-" + m.id, { type: "json" })));
      return json({ people: full.filter((m) => m && M.canDM(me, m)).map((m) => ({ id: m.id, name: m.name, role: m.role, teams: m.teams || [], kids: (m.kids || []).map((k) => k.name) })) });
    }
    if (q("fees") || q("csv")) {
      const names = await teamNames(store);
      const fees = await F.feesFor(store, me, Object.keys(names));
      if (q("csv")) {
        const fee = fees.find((x) => x.id === q("csv") && x.manage);
        if (!fee) return json({ error: "not found" }, 404);
        return new Response(F.csv(fee), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fee.title.replace(/[^A-Za-z0-9 _-]/g, "")}.csv"` } });
      }
      return json({ fees, kinds: F.KINDS });
    }
    return json({ error: "bad request" }, 400);
  }
  if (req.method !== "POST") return json({ error: "bad request" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const k = b && b.kind;
  if (k === "join") {
    const r = b.invite ? await joinWithInvite(store, b, me) : await joinWithCode(store, b, me);
    return r.error ? json({ error: r.error }, r.status) : json({ ok: true, token: r.token, me: pub(r.member) });
  }
  if (!me) return json({ error: "Join the club first" }, 401);
  switch (k) {
    case "profile": { const n = cleanName(b.name); if (n) me.name = n; await saveMember(store, me); return json({ ok: true, me: pub(me) }); }
    case "invite": return out(await createInvite(store, me, b.team));
    case "link": return out(await link(store, me, b, true));
    case "unlink": return out(await link(store, me, b, false));
    case "offteam": return out(await removeFromTeam(store, me, b));
    case "role": return out(await setRole(store, me, b));
    case "remove": return out(await removeMember(store, me, b));
    case "addkid": return out(await myKid(store, me, b, true));
    case "dropkid": return out(await myKid(store, me, b, false));
    case "send": {
      const c = M.parseCh(b.ch); const names = c && c.type === "team" ? await teamNames(store) : {};
      return out(await M.send(store, me, b.ch, b.text, { origin: url.origin, teamName: c && c.type === "team" ? names[c.team] : "" }));
    }
    case "del": return out(await M.remove(store, me, b.ch, b.id));
    case "pin": return out(await M.pin(store, me, b.ch, b.text));
    case "read": { if (!(await M.canRead(store, me, b.ch))) return json({ error: "no" }, 403); me.read = me.read || {}; me.read[b.ch] = Math.min(Date.now(), Number(b.at) || Date.now()); await store.setJSON("mem-" + me.id, me); return json({ ok: true }); }
    case "fee": {
      const r = await F.createFee(store, me, b);
      if (r.fee) {
        // Let the parents of everyone who owes it know.
        try {
          const names = await teamNames(store);
          const who = await F.owers(store, r.fee, Object.keys(names));
          const keys = new Set(who.map((o) => o.team + "." + o.player));
          const parents = (await Promise.all((await allMembers(store)).filter((m) => m.role === "parent").map((m) => store.get("mem-" + m.id, { type: "json" }))))
            .filter((m) => m && (m.kids || []).some((k) => keys.has(k.team + "." + k.player)));
          const t = r.fee.scope.team;
          await P.notify(store, parents.map((m) => m.id), "fees", { title: "New fee: " + r.fee.title, body: `$${(r.fee.amount / 100).toFixed(2)}${r.fee.due ? ", due " + r.fee.due : ""}. Tap to pay.`, tag: "fee-" + r.fee.id, url: (t ? "/?team=" + encodeURIComponent(t) + "&" : "/?") + "fees=1" }, url.origin);
        } catch (e) { /* the fee is saved either way */ }
      }
      return out(r);
    }
    case "pushsub": return out(await P.saveSub(store, me, b.sub, b.prefs));
    case "pushprefs": return out(await P.setPrefs(store, me, b.prefs));
    case "pushoff": return out(await P.removeSub(store, me, String(b.endpoint || "")));
    case "pushtest": { const r = await P.notify(store, [me.id], "msg", { title: "Notifications are on", body: "You'll get team messages, fees and game alerts here.", tag: "test", url: "/" }, url.origin); return json({ ok: true, ...r }); }
    case "feearchive": {
      const fee = await store.get("fee-" + b.fee, { type: "json" });
      if (!fee || !F.canManage(me, fee)) return json({ error: "not allowed" }, 403);
      fee.archived = !b.restore; await store.setJSON("fee-" + fee.id, fee); return json({ ok: true });
    }
    case "pay": return out(await F.setStatus(store, me, b));
    case "nudge": {
      // A direct message from the coach to each parent of a player who still owes this fee.
      const names = await teamNames(store);
      const fee = (await F.feesFor(store, me, Object.keys(names))).find((x) => x.id === b.fee && x.manage);
      if (!fee) return json({ error: "not allowed" }, 403);
      const owing = fee.players.filter((v) => ["unpaid", "pending"].includes(v.status) && v.owed > v.paid && v.status !== "pending");
      const parents = (await Promise.all((await allMembers(store)).map((m) => store.get("mem-" + m.id, { type: "json" })))).filter((m) => m && m.role === "parent");
      let sent = 0;
      for (const p of parents) {
        const kids = owing.filter((v) => (p.kids || []).some((k) => k.team === v.team && k.player === v.player));
        if (!kids.length || !M.canDM(me, p)) continue;
        const amt = kids.map((v) => `${v.name}: $${((v.owed - v.paid) / 100).toFixed(2)}`).join(", ");
        const r = await M.send(store, me, M.dmId(me.id, p.id), `Friendly reminder: ${fee.title} is due${fee.due ? " " + fee.due : ""}. ${amt}. You can pay in the app under Fees. Thank you!`, { origin: url.origin });
        if (!r.error) sent++;
      }
      return json({ ok: true, sent, owing: owing.length });
    }
    case "payee": return out(await F.setPayee(store, me, b));
    case "ppcreate": try { return out(await F.ppCreate(store, me, b, f)); } catch (e) { return json({ error: "PayPal couldn't start the payment" }, 502); }
    case "ppcapture": try { return out(await F.ppCapture(store, me, b, f)); } catch (e) { return json({ error: "PayPal couldn't finish the payment" }, 502); }
  }
  return json({ error: "bad request" }, 400);
}

export default (req) => handle(req);
export const config = { path: "/api/club" };
