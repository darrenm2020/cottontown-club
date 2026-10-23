import { okId, newId, isAdmin, isCoachOf, cleanName } from "./members.mjs";

// Fees parents pay (club dues, tournament fees, ref fees, shared expenses) and who has paid.
// Money goes to a payee: the club (treasurer) or a team (team manager), each with their own Venmo and PayPal.
// Amounts are in cents. Each player's payment is its own blob so a parent and a coach updating at once don't collide.

export const KINDS = { dues: "Club dues", tournament: "Tournament fee", ref: "Ref fees", expense: "Shared expense" };
export const STATUSES = ["unpaid", "pending", "paid", "outside", "waived"];
const PAYPAL_PCT = 3.49, PAYPAL_FIXED = 49; // PayPal's standard US checkout rate; a payee can override it

// What the parent pays so the payee still receives the full amount after PayPal's cut.
export function withFee(cents, pct = PAYPAL_PCT, fixed = PAYPAL_FIXED) {
  if (cents <= 0) return 0;
  return Math.ceil((cents + fixed) / (1 - pct / 100));
}
const money = (c) => "$" + (c / 100).toFixed(2);
const payeeKey = (p) => (p && p.type === "team" && okId(p.team) ? "payee-" + p.team : "payee-club");
const rowKey = (feeId, team, player) => `pay/${feeId}/${team}.${player}`;

export function canManage(me, fee) { return isAdmin(me) || (fee.scope.type !== "club" && isCoachOf(me, fee.scope.team)); }

async function teamCfg(store, team) { const v = await store.get("team-" + team, { type: "json" }); return (v && v.team) || null; }
// Everyone who owes this fee: [{team, player, name}]
export async function owers(store, fee, teamIds) {
  const out = [];
  const add = (team, c, ids) => (c && c.players || []).forEach((p) => { if ((ids ? ids.includes(p.id) : !p.guest || fee.guests)) out.push({ team, player: p.id, name: p.name }); });
  if (fee.scope.type === "club") for (const t of teamIds) add(t, await teamCfg(store, t));
  else if (fee.scope.type === "team") add(fee.scope.team, await teamCfg(store, fee.scope.team));
  else add(fee.scope.team, await teamCfg(store, fee.scope.team), fee.scope.players || []);
  return out;
}

export async function createFee(store, me, b) {
  const kind = KINDS[b.feeKind] ? b.feeKind : "expense"; // b.kind is the request type ("fee")
  const amount = Math.round(Number(b.amount) * 100);
  if (!(amount > 0 && amount <= 500000)) return { error: "Enter an amount between $0.01 and $5,000", status: 400 };
  const title = cleanName(b.title) || KINDS[kind];
  const st = b.scope || {};
  let scope;
  if (st.type === "club") { if (!isAdmin(me)) return { error: "Only club admins can bill the whole club", status: 403 }; scope = { type: "club" }; }
  else if (okId(st.team)) {
    if (!isCoachOf(me, st.team)) return { error: "Only this team's coaches can bill it", status: 403 };
    scope = st.type === "players" ? { type: "players", team: st.team, players: (st.players || []).filter((x) => typeof x === "string").slice(0, 60) } : { type: "team", team: st.team };
  } else return { error: "Choose who pays", status: 400 };
  // Club dues and club-wide fees go to the club; team fees to the team unless the coach picks the club.
  const payee = scope.type === "club" || b.payee === "club" ? { type: "club" } : { type: "team", team: scope.team };
  const fee = { id: newId("f"), kind, title, amount, due: /^\d{4}-\d{2}-\d{2}$/.test(b.due || "") ? b.due : "", note: String(b.note || "").slice(0, 300),
    scope, payee, guests: !!b.guests, by: me.id, at: Date.now() };
  await store.setJSON("fee-" + fee.id, fee);
  const idx = (await store.get("fees", { type: "json" })) || [];
  idx.push({ id: fee.id, scope: fee.scope.type === "club" ? "club" : fee.scope.team, at: fee.at });
  await store.setJSON("fees", idx);
  return { fee };
}

function view(fee, row, ower) {
  const r = row || { status: "unpaid" };
  const sch = Math.max(0, Math.min(fee.amount, r.sch || 0));
  const owed = fee.amount - sch;
  const status = owed <= 0 && sch > 0 && r.status !== "paid" ? "scholarship" : r.status;
  return { team: ower.team, player: ower.player, name: ower.name, status, owed, sch, paid: r.paid || 0, method: r.method || "", note: r.note || "", at: r.at || 0 };
}
const settled = (v) => ["paid", "outside", "waived", "scholarship"].includes(v.status);

// Fees as one member sees them: managers see every player; parents see only their own kids.
export async function feesFor(store, me, teamIds) {
  const idx = (await store.get("fees", { type: "json" })) || [];
  const mine = (me.kids || []).map((k) => k.team + "." + k.player);
  const out = [];
  for (const it of idx.slice(-200)) {
    const fee = await store.get("fee-" + it.id, { type: "json" });
    if (!fee || fee.archived) continue;
    const manage = canManage(me, fee);
    const all = await owers(store, fee, teamIds);
    // Coaches also see (but can't change) club fees for their own team's players.
    const sees = (o) => mine.includes(o.team + "." + o.player) || isCoachOf(me, o.team);
    const rel = manage ? all : all.filter(sees);
    if (!rel.length) continue;
    const { blobs } = await store.list({ prefix: `pay/${fee.id}/` });
    const rows = Object.fromEntries(await Promise.all(blobs.map(async (bk) => [bk.key.split("/").pop(), await store.get(bk.key, { type: "json" })])));
    const players = rel.map((o) => view(fee, rows[o.team + "." + o.player], o));
    const payee = (await store.get(payeeKey(fee.payee), { type: "json" })) || {};
    const pct = payee.pct ?? PAYPAL_PCT, fixed = payee.fixed ?? PAYPAL_FIXED;
    out.push({ ...fee, manage, payeeInfo: { name: payee.name || (fee.payee.type === "club" ? "Club treasurer" : "Team manager"), venmo: payee.venmo || "", paypal: !!(payee.paypal && payee.paypal.clientId), clientId: payee.paypal ? payee.paypal.clientId : "", env: payee.paypal ? payee.paypal.env : "" },
      players: players.map((v) => ({ ...v, withFee: withFee(v.owed - v.paid, pct, fixed), sch: manage || isCoachOf(me, v.team) || mine.includes(v.team + "." + v.player) ? v.sch : 0 })),
      totals: manage ? { owed: players.reduce((t, v) => t + v.owed, 0), paid: players.reduce((t, v) => t + (["paid", "outside"].includes(v.status) ? v.owed : 0), 0), settled: players.filter(settled).length, count: players.length } : null });
  }
  return out.sort((a, b) => (a.due || "9").localeCompare(b.due || "9") || b.at - a.at);
}

// Coaches set any status, a scholarship or a note; a parent can only say "I paid" (pending) for their own kid.
export async function setStatus(store, me, b) {
  const fee = await store.get("fee-" + b.fee, { type: "json" });
  if (!fee) return { error: "not found", status: 404 };
  if (!okId(b.team) || typeof b.player !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(b.player)) return { error: "bad request", status: 400 };
  const manage = canManage(me, fee);
  const isMine = (me.kids || []).some((k) => k.team === b.team && k.player === b.player);
  const k = rowKey(fee.id, b.team, b.player);
  const row = (await store.get(k, { type: "json" })) || { status: "unpaid" };
  if (!manage) {
    if (!isMine || b.status !== "pending" || row.status === "paid") return { error: "Only a coach can change this", status: 403 };
    Object.assign(row, { status: "pending", method: ["venmo", "cash", "check", "other"].includes(b.method) ? b.method : "venmo", at: Date.now(), by: me.id });
  } else {
    if (b.status && !STATUSES.includes(b.status)) return { error: "bad status", status: 400 };
    if (b.status) row.status = b.status;
    if (b.sch != null) row.sch = Math.max(0, Math.min(fee.amount, Math.round(Number(b.sch) * 100) || 0));
    if (b.note != null) row.note = String(b.note).slice(0, 200);
    if (b.method) row.method = String(b.method).slice(0, 20);
    if (row.status === "paid" || row.status === "outside") row.paid = row.paid || fee.amount - (row.sch || 0);
    if (row.status === "unpaid") row.paid = 0;
    Object.assign(row, { at: Date.now(), by: me.id });
  }
  await store.setJSON(k, row);
  return { ok: true, row };
}

export async function setPayee(store, me, b) {
  const p = b.payee === "club" ? { type: "club" } : { type: "team", team: b.payee };
  if (p.type === "club" ? !isAdmin(me) : !isCoachOf(me, p.team)) return { error: "Only an admin (club) or this team's coach can set this", status: 403 };
  const k = payeeKey(p);
  const cur = (await store.get(k, { type: "json" })) || {};
  if (b.name != null) cur.name = cleanName(b.name);
  if (b.venmo != null) cur.venmo = String(b.venmo).replace(/^@/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);
  if (b.paypal === null) delete cur.paypal;
  else if (b.paypal && b.paypal.clientId) {
    const env = b.paypal.env === "live" ? "live" : "sandbox";
    cur.paypal = { clientId: String(b.paypal.clientId).trim().slice(0, 120), secret: String(b.paypal.secret || (cur.paypal && cur.paypal.secret) || "").trim().slice(0, 200), env };
  }
  await store.setJSON(k, cur);
  return { ok: true, payee: { name: cur.name || "", venmo: cur.venmo || "", paypal: !!cur.paypal, env: cur.paypal ? cur.paypal.env : "" } };
}

// PayPal checkout (PayPal and Venmo buttons) using the payee's own PayPal app keys.
const ppBase = (env) => (env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
async function ppToken(pp, f) {
  const r = await f(ppBase(pp.env) + "/v1/oauth2/token", { method: "POST", headers: { Authorization: "Basic " + btoa(pp.clientId + ":" + pp.secret), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!r.ok) throw new Error("PayPal sign-in failed");
  return (await r.json()).access_token;
}
async function payContext(store, me, b) {
  const fee = await store.get("fee-" + b.fee, { type: "json" });
  if (!fee) return { error: "not found", status: 404 };
  const isMine = (me.kids || []).some((k) => k.team === b.team && k.player === b.player);
  if (!isMine && !canManage(me, fee)) return { error: "not your fee", status: 403 };
  const payee = (await store.get(payeeKey(fee.payee), { type: "json" })) || {};
  if (!payee.paypal || !payee.paypal.clientId || !payee.paypal.secret) return { error: "PayPal isn't set up for this payee", status: 400 };
  const row = (await store.get(rowKey(fee.id, b.team, b.player), { type: "json" })) || { status: "unpaid" };
  const left = fee.amount - (row.sch || 0) - (row.paid || 0);
  if (left <= 0 || ["paid", "outside", "waived"].includes(row.status)) return { error: "Already settled", status: 409 };
  const total = withFee(left, payee.pct ?? PAYPAL_PCT, payee.fixed ?? PAYPAL_FIXED);
  return { fee, payee, row, left, total };
}
export async function ppCreate(store, me, b, f = fetch) {
  const c = await payContext(store, me, b);
  if (c.error) return c;
  const tok = await ppToken(c.payee.paypal, f);
  const r = await f(ppBase(c.payee.paypal.env) + "/v2/checkout/orders", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ custom_id: `${c.fee.id}|${b.team}|${b.player}`, description: `${c.fee.title} (${money(c.left)} + processing)`.slice(0, 120), amount: { currency_code: "USD", value: (c.total / 100).toFixed(2) } }] }) });
  const j = await r.json();
  if (!r.ok || !j.id) return { error: "PayPal couldn't start the payment", status: 502 };
  return { orderId: j.id, total: c.total };
}
export async function ppCapture(store, me, b, f = fetch) {
  const c = await payContext(store, me, b);
  if (c.error) return c;
  if (!/^[A-Z0-9]{5,40}$/.test(String(b.orderId || ""))) return { error: "bad order", status: 400 };
  const tok = await ppToken(c.payee.paypal, f);
  const r = await f(ppBase(c.payee.paypal.env) + "/v2/checkout/orders/" + b.orderId + "/capture", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" } });
  const j = await r.json();
  const pu = j.purchase_units && j.purchase_units[0];
  const cap = pu && pu.payments && pu.payments.captures && pu.payments.captures[0];
  // Only mark paid when PayPal says the money moved, for this fee and player, for at least what was asked.
  const value = cap ? Math.round(Number(cap.amount.value) * 100) : 0;
  if (!r.ok || j.status !== "COMPLETED" || !cap || cap.status !== "COMPLETED" || (pu.custom_id || cap.custom_id) !== `${c.fee.id}|${b.team}|${b.player}` || value < c.total)
    return { error: "PayPal didn't confirm the payment", status: 402 };
  const k = rowKey(c.fee.id, b.team, b.player);
  const row = { ...c.row, status: "paid", method: "paypal", paid: c.left + (c.row.paid || 0), charged: value, ref: cap.id, at: Date.now(), by: me.id };
  await store.setJSON(k, row);
  return { ok: true, row };
}

export function csv(fee) {
  const q = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  const lines = [["Player", "Team", "Status", "Owed", "Scholarship", "Paid", "Method", "Note"].map(q).join(",")];
  fee.players.forEach((v) => lines.push([v.name, v.team, v.status, (v.owed / 100).toFixed(2), (v.sch / 100).toFixed(2), (v.paid / 100).toFixed(2), v.method, v.note].map(q).join(",")));
  return lines.join("\n");
}
