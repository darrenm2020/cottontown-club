import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.mjs";
import { _reset, getStore } from "./blobs-mock.mjs";
const { default: state } = await import("../netlify/functions/state.mjs");
const { handle: club } = await import("../netlify/functions/club.mjs");
const { handle: help } = await import("../netlify/functions/help.mjs");
const { handle: admin } = await import("../netlify/functions/admin.mjs");
const { handle: report } = await import("../netlify/functions/report.mjs");

const db = () => getStore({ name: "cottontown" });
const bk = () => getStore({ name: "cottontown-backups" });
const req = (path, body, token) => new Request("https://t" + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
const J = async (r) => ({ status: r.status, j: await r.json().catch(() => null) });
const fake = (obj) => ({ calls: [], beta: { messages: { create: async function (p) { this.p = p; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] }; } } }, messages: { create: async () => ({}) } });

beforeEach(async () => {
  _reset();
  await call(state, "POST", "/api/state", { kind: "config", team: "t1", config: { name: "Test", players: [{ id: "a", name: "Ann" }], games: [{ id: "g1" }] }, code: "master-code" });
  await call(state, "POST", "/api/state", { kind: "game", team: "t1", gid: "g1", game: { goals: [] }, code: "master-code" });
});

test("help desk answers from the guide, knows the page, limits each device, and can escalate", async () => {
  const f = fake({ answer: "Tap Setup → Fix a problem.", escalate: false });
  const r = await J(await help(req("/api/help", { kind: "ask", question: "A game reset by mistake", dv: "dev1", ctx: { role: "coach", page: "team", team: "Test", tab: "bench", ver: "x" } }), { store: db(), client: { beta: f.beta, messages: f.messages } }));
  assert.equal(r.j.answer, "Tap Setup → Fix a problem.");
  assert.match(f.beta.messages.p.system, /Fix a problem/);
  assert.match(f.beta.messages.p.system, /The person is a coach/);
  assert.match(f.beta.messages.p.system, /tab bench/);
  await db().setJSON("help-" + new Date().toISOString().slice(0, 10), { n: 1, dv: { dev1: 30 } });
  const lim = await J(await help(req("/api/help", { kind: "ask", question: "again", dv: "dev1" }), { store: db(), client: fake({}) }));
  assert.equal(lim.status, 429);
  assert.equal((await J(await help(req("/api/help", { kind: "ask", question: "x" }), { store: db() }))).status, 400, "device id needed");
});

test("help requests reach admins as a ticket and a direct message", async () => {
  const adm = (await J(await club(req("/api/club", { kind: "join", team: "t1", code: "master-code", name: "Darren" }), { store: db() }))).j;
  await call(state, "POST", "/api/state", { kind: "setcode", team: "t1", newCode: "coach-code", code: "master-code" });
  const co = (await J(await club(req("/api/club", { kind: "join", team: "t1", code: "coach-code", name: "Coach" }), { store: db() }))).j;
  const t = await J(await help(req("/api/help", { kind: "ticket", text: "Fees show the wrong amount", dv: "dev2", ctx: { team: "Test", tab: "fees" } }, co.token), { store: db() }));
  assert.equal(t.j.messaged, 1);
  const ib = (await J(await club(new Request("https://t/api/club?inbox=1", { headers: { Authorization: "Bearer " + adm.token } }), { store: db() }))).j.channels;
  assert.match(ib.find((c) => c.dm).last.text, /Help request: Fees show the wrong amount/);
  const tk = (await J(await admin(req("/api/admin", { code: "master-code", kind: "tickets" }), { store: db(), bstore: bk() }))).j.tickets;
  assert.equal(tk[0].from, "Coach");
  assert.equal((await J(await admin(req("/api/admin", { code: "wrong", kind: "tickets" }), { store: db(), bstore: bk() }))).status, 401);
});

test("problem reports group repeats into one entry with a count", async () => {
  for (let i = 0; i < 3; i++) await report(req("/api/report", { msg: "TypeError: x is undefined", ver: "v1", team: "t1" }), { store: db() });
  await report(req("/api/report", { msg: "Save failed (500)", ver: "v1" }), { store: db() });
  const p = (await J(await admin(req("/api/admin", { code: "master-code", kind: "problems" }), { store: db(), bstore: bk() }))).j.problems;
  assert.equal(p.length, 2);
  assert.equal(p.find((x) => x.msg.startsWith("TypeError")).n, 3);
});

test("backups copy club data (not tokens or history), blank PayPal secrets, and keep 30 days", async () => {
  await db().setJSON("payee-t1", { venmo: "x", paypal: { clientId: "C", secret: "S" } });
  await db().setJSON("tok-abc", { id: "m1" });
  await bk().setJSON("2000-01-01", { at: 0, data: {} });
  const r = (await J(await admin(req("/api/admin", { code: "master-code", kind: "backupnow" }), { store: db(), bstore: bk() }))).j;
  assert.ok(r.count >= 3);
  const days = (await J(await admin(req("/api/admin", { code: "master-code", kind: "backups" }), { store: db(), bstore: bk() }))).j.days;
  assert.deepEqual(days, [new Date().toISOString().slice(0, 10)], "old backup removed");
  const dl = await admin(req("/api/admin", { code: "master-code", kind: "backup", day: days[0] }), { store: db(), bstore: bk() });
  const data = (await dl.json()).data;
  assert.ok(data["team-t1"] && data["game-t1-g1"]);
  assert.equal(data["payee-t1"].paypal.secret, "");
  assert.equal(data["tok-abc"], undefined);
  assert.ok(!Object.keys(data).some((k) => k.startsWith("hist-")));
});
