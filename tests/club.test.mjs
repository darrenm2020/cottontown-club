import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.mjs";
import { _reset, getStore } from "./blobs-mock.mjs";
const { default: state } = await import("../netlify/functions/state.mjs");
const { handle } = await import("../netlify/functions/club.mjs");
const { withFee } = await import("../netlify/lib/fees.mjs");

const db = () => getStore({ name: "cottontown" });
let fakeFetch = null;
const api = async (method, qs, body, token) => {
  const r = await handle(new Request("https://t/api/club" + (qs || ""), { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), { store: db(), fetch: fakeFetch });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
};
const team = (id, players) => call(state, "POST", "/api/state", { kind: "config", team: id, config: { name: id.toUpperCase(), players, games: [] }, code: "master-code" });
let admin, coachA, parentA, parentA2, parentB, coachB, invA;

beforeEach(async () => {
  _reset(); fakeFetch = null;
  await team("a", [{ id: "ann", name: "Ann" }, { id: "bea", name: "Bea" }, { id: "gus", name: "Gus", guest: true }]);
  await team("b", [{ id: "cal", name: "Cal" }]);
  await call(state, "POST", "/api/state", { kind: "setcode", team: "a", newCode: "code-a", code: "master-code" });
  await call(state, "POST", "/api/state", { kind: "setcode", team: "b", newCode: "code-b", code: "master-code" });
  admin = (await api("POST", "", { kind: "join", team: "a", code: "master-code", name: "Darren" })).j;
  coachA = (await api("POST", "", { kind: "join", team: "a", code: "code-a", name: "Coach A" })).j;
  coachB = (await api("POST", "", { kind: "join", team: "b", code: "code-b", name: "Coach B" })).j;
  invA = (await api("POST", "", { kind: "invite", team: "a" }, coachA.token)).j.code;
  parentA = (await api("POST", "", { kind: "join", invite: invA, name: "Pat", kids: ["ann", "nobody"] })).j;
  parentA2 = (await api("POST", "", { kind: "join", invite: invA, name: "Quinn", kids: ["bea"] })).j;
  const invB = (await api("POST", "", { kind: "invite", team: "b" }, coachB.token)).j.code;
  parentB = (await api("POST", "", { kind: "join", invite: invB, name: "Rae", kids: ["cal"] })).j;
});

test("joining: roles, kids, bad codes, invites", async () => {
  assert.equal(admin.me.role, "admin");
  assert.equal(coachA.me.role, "coach");
  assert.deepEqual(parentA.me.kids.map((k) => k.player), ["ann"], "unknown player ignored");
  assert.equal((await api("POST", "", { kind: "join", team: "a", code: "wrong" })).status, 401);
  assert.equal((await api("POST", "", { kind: "invite", team: "a" }, parentA.token)).status, 403, "parents can't make invites");
  assert.equal((await api("POST", "", { kind: "invite", team: "a" }, coachB.token)).status, 403, "other team's coach can't");
  const inv = await api("GET", "?invite=" + invA);
  assert.deepEqual(inv.j.players.map((p) => p.id), ["ann", "bea"], "guests not offered");
  assert.equal((await api("GET", "?me=1", null, "made-up-token")).status, 401);
});

test("channel rules: club announcements, coaches room, team chat", async () => {
  assert.equal((await api("POST", "", { kind: "send", ch: "club", text: "Tryouts Saturday" }, admin.token)).status, 200);
  assert.equal((await api("POST", "", { kind: "send", ch: "club", text: "hi" }, coachA.token)).status, 403, "only admins announce");
  assert.equal((await api("GET", "?ch=club", null, parentB.token)).j.messages.length, 1, "everyone reads announcements");
  assert.equal((await api("POST", "", { kind: "send", ch: "coaches", text: "Meeting" }, coachB.token)).status, 200);
  assert.equal((await api("GET", "?ch=coaches", null, parentA.token)).status, 403, "parents can't read the coaches room");
  assert.equal((await api("POST", "", { kind: "send", ch: "t.a", text: "Bring water" }, parentA.token)).status, 200);
  assert.equal((await api("GET", "?ch=t.a", null, parentB.token)).status, 403, "other team's parents can't read");
  assert.equal((await api("GET", "?ch=t.a", null, admin.token)).j.messages[0].text, "Bring water", "admins can read any team");
});

test("direct messages: team parents and coaches, admin to anyone, not across teams", async () => {
  const dm = (x, y) => "dm." + [x.me.id, y.me.id].sort().join(".");
  assert.equal((await api("POST", "", { kind: "send", ch: dm(parentA, parentA2), text: "Carpool?" }, parentA.token)).status, 200, "same-team parents");
  assert.equal((await api("POST", "", { kind: "send", ch: dm(parentA, coachA), text: "Late today" }, parentA.token)).status, 200, "parent to own coach");
  assert.equal((await api("POST", "", { kind: "send", ch: dm(parentA, parentB), text: "hey" }, parentA.token)).status, 403, "parents on different teams");
  assert.equal((await api("POST", "", { kind: "send", ch: dm(admin, parentB), text: "Welcome" }, admin.token)).status, 200, "admin to anyone");
  assert.equal((await api("GET", "?ch=" + dm(parentA, parentA2), null, coachA.token)).status, 403, "a DM is private, even from coaches");
  const people = (await api("GET", "?people=1", null, parentA.token)).j.people.map((p) => p.name).sort();
  assert.deepEqual(people, ["Coach A", "Darren", "Quinn"]);
  const ib = (await api("GET", "?inbox=1", null, parentA2.token)).j.channels;
  const c = ib.find((x) => x.dm);
  assert.equal(c.title, "Pat"); assert.equal(c.unread, true);
  await api("POST", "", { kind: "read", ch: c.ch }, parentA2.token);
  assert.equal((await api("GET", "?inbox=1", null, parentA2.token)).j.channels.find((x) => x.dm).unread, false);
});

test("deleting: sender or coach, not other parents", async () => {
  const sent = (await api("POST", "", { kind: "send", ch: "t.a", text: "oops" }, parentA.token)).j.message;
  assert.equal((await api("POST", "", { kind: "del", ch: "t.a", id: sent.id }, parentA2.token)).status, 403);
  assert.equal((await api("POST", "", { kind: "del", ch: "t.a", id: sent.id }, coachA.token)).status, 200);
  assert.equal((await api("GET", "?ch=t.a", null, parentA.token)).j.messages[0].deleted, true);
});

test("fees: who can bill, what parents see, statuses and scholarships", async () => {
  assert.equal((await api("POST", "", { kind: "fee", kind2: "", title: "Dues", amount: 150, scope: { type: "club" } }, coachA.token)).status, 403, "only admins bill the club");
  const club = (await api("POST", "", { kind: "fee", title: "Fall dues", amount: 150, scope: { type: "club" }, due: "2026-11-01" }, admin.token)).j.fee;
  Object.assign(club, { kind: "dues" });
  const ref = (await api("POST", "", { kind: "fee", title: "Ref fees", amount: 12.5, scope: { type: "team", team: "a" } }, coachA.token)).j.fee;
  assert.equal((await api("POST", "", { kind: "fee", title: "x", amount: 5, scope: { type: "team", team: "b" } }, coachA.token)).status, 403);
  // Parent sees only their own kid, with PayPal fee added on top.
  const pf = (await api("GET", "?fees=1", null, parentA.token)).j.fees;
  assert.deepEqual(pf.map((x) => x.players.map((p) => p.player)), [["ann"], ["ann"]]);
  assert.equal(pf.find((x) => x.id === ref.id).players[0].withFee, withFee(1250));
  assert.equal(pf[0].totals, null, "parents don't see team totals");
  // Coach of A sees all of team A (no guest) on both fees; club fee lists all players of all teams for the admin.
  const cf = (await api("GET", "?fees=1", null, coachA.token)).j.fees;
  assert.deepEqual(cf.find((x) => x.id === ref.id).players.map((p) => p.player), ["ann", "bea"]);
  const cc = cf.find((x) => x.id === club.id);
  assert.equal(cc.manage, false, "team coach can't manage club dues");
  assert.deepEqual(cc.players.map((p) => p.player), ["ann", "bea"], "but sees their own players");
  const af = (await api("GET", "?fees=1", null, admin.token)).j.fees.find((x) => x.id === club.id);
  assert.deepEqual(af.players.map((p) => p.player).sort(), ["ann", "bea", "cal"]);
  // Parent says "I paid" by Venmo -> pending; can't mark paid; can't touch another kid.
  assert.equal((await api("POST", "", { kind: "pay", fee: ref.id, team: "a", player: "ann", status: "pending", method: "venmo" }, parentA.token)).status, 200);
  assert.equal((await api("POST", "", { kind: "pay", fee: ref.id, team: "a", player: "ann", status: "paid" }, parentA.token)).status, 403);
  assert.equal((await api("POST", "", { kind: "pay", fee: ref.id, team: "a", player: "bea", status: "pending" }, parentA.token)).status, 403);
  // Coach confirms, gives Bea a full scholarship.
  await api("POST", "", { kind: "pay", fee: ref.id, team: "a", player: "ann", status: "outside", method: "venmo", note: "Venmo 10/24" }, coachA.token);
  await api("POST", "", { kind: "pay", fee: ref.id, team: "a", player: "bea", sch: 12.5 }, coachA.token);
  const after = (await api("GET", "?fees=1", null, coachA.token)).j.fees.find((x) => x.id === ref.id);
  assert.deepEqual(after.players.map((p) => p.status), ["outside", "scholarship"]);
  assert.deepEqual(after.totals, { owed: 1250, paid: 1250, settled: 2, count: 2 });
  // Other parents never see a scholarship amount.
  assert.equal((await api("GET", "?fees=1", null, parentA2.token)).j.fees.find((x) => x.id === ref.id).players[0].sch, 1250, "but Bea's own parent does");
  const csv = await api("GET", "?csv=" + ref.id, null, coachA.token);
  assert.match(csv.text, /"Ann","a","outside","12.50"/);
  assert.equal((await api("GET", "?csv=" + ref.id, null, parentA.token)).status, 404);
});

test("processing fee math covers PayPal so the payee gets the full amount", () => {
  for (const c of [1250, 4500, 15000]) {
    const t = withFee(c);
    const net = t - Math.round(t * 0.0349) - 49;
    assert.ok(net >= c && net - c <= 1, `${c} -> ${t} nets ${net}`);
  }
  assert.equal(withFee(4500), 4714);
});

test("PayPal: order uses the payee's keys and the fee-inclusive total; only a confirmed capture marks paid", async () => {
  const fee = (await api("POST", "", { kind: "fee", title: "KICKS", amount: 45, scope: { type: "team", team: "a" } }, coachA.token)).j.fee;
  assert.equal((await api("POST", "", { kind: "ppcreate", fee: fee.id, team: "a", player: "ann" }, parentA.token)).status, 400, "no PayPal set up yet");
  assert.equal((await api("POST", "", { kind: "payee", payee: "a", venmo: "@Team-A_Manager", paypal: { clientId: "CID", secret: "SEC" } }, parentA.token)).status, 403);
  const pe = await api("POST", "", { kind: "payee", payee: "a", venmo: "@Team-A_Manager", paypal: { clientId: "CID", secret: "SEC" } }, coachA.token);
  assert.equal(pe.j.payee.venmo, "Team-A_Manager"); assert.equal(pe.j.payee.secret, undefined, "secret never sent back");
  const calls = [];
  let captureBody = null;
  fakeFetch = async (u, o) => { calls.push({ u, o }); const R = (j, ok = true) => ({ ok, json: async () => j });
    if (u.endsWith("/v1/oauth2/token")) return R({ access_token: "T" });
    if (u.endsWith("/v2/checkout/orders")) return R({ id: "ORDER123" });
    return R(captureBody); };
  const cr = await api("POST", "", { kind: "ppcreate", fee: fee.id, team: "a", player: "ann" }, parentA.token);
  assert.equal(cr.j.orderId, "ORDER123");
  assert.match(calls[0].u, /sandbox/);
  assert.equal(calls[0].o.headers.Authorization, "Basic " + btoa("CID:SEC"));
  const order = JSON.parse(calls[1].o.body);
  assert.equal(order.purchase_units[0].amount.value, "47.14");
  assert.equal(order.purchase_units[0].custom_id, `${fee.id}|a|ann`);
  // A capture for the wrong player is rejected.
  captureBody = { status: "COMPLETED", purchase_units: [{ custom_id: `${fee.id}|a|bea`, payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { value: "47.14" } }] } }] };
  assert.equal((await api("POST", "", { kind: "ppcapture", fee: fee.id, team: "a", player: "ann", orderId: "ORDER123" }, parentA.token)).status, 402);
  captureBody.purchase_units[0].custom_id = `${fee.id}|a|ann`;
  const ok = await api("POST", "", { kind: "ppcapture", fee: fee.id, team: "a", player: "ann", orderId: "ORDER123" }, parentA.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.j.row.status, "paid"); assert.equal(ok.j.row.paid, 4500); assert.equal(ok.j.row.charged, 4714);
  assert.equal((await api("POST", "", { kind: "ppcreate", fee: fee.id, team: "a", player: "ann" }, parentA.token)).status, 409, "can't pay twice");
});

test("nudge sends one DM per parent who still owes, skipping paid and pending", async () => {
  const fee = (await api("POST", "", { kind: "fee", title: "KICKS", amount: 45, scope: { type: "team", team: "a" }, due: "2026-11-01" }, coachA.token)).j.fee;
  await api("POST", "", { kind: "pay", fee: fee.id, team: "a", player: "bea", status: "pending" }, parentA2.token);
  const r = await api("POST", "", { kind: "nudge", fee: fee.id }, coachA.token);
  assert.equal(r.j.sent, 1);
  const ib = (await api("GET", "?inbox=1", null, parentA.token)).j.channels.find((x) => x.dm);
  assert.match(ib.last.text, /KICKS is due 2026-11-01\. Ann: \$45\.00/);
  assert.equal((await api("POST", "", { kind: "nudge", fee: fee.id }, parentA.token)).status, 403);
});
