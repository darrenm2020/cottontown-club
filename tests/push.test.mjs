import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.mjs";
import { _reset, getStore } from "./blobs-mock.mjs";
const { default: state } = await import("../netlify/functions/state.mjs");
const { handle } = await import("../netlify/functions/club.mjs");
const { _setSender } = await import("../netlify/lib/push.mjs");

const db = () => getStore({ name: "cottontown" });
const api = async (method, qs, body, token) => {
  const r = await handle(new Request("https://club.test/api/club" + (qs || ""), { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), { store: db() });
  return { status: r.status, j: await r.json().catch(() => null) };
};
let sent = [];
const sub = (n) => ({ endpoint: "https://push.example/" + n, keys: { p256dh: "BK" + n, auth: "A" + n } });
let admin, coach, pat, quinn, rae;

beforeEach(async () => {
  _reset(); sent = [];
  _setSender(async (s, payload) => { if (s.endpoint.endsWith("dead")) { const e = new Error("gone"); e.statusCode = 410; throw e; } sent.push({ to: s.endpoint, ...JSON.parse(payload) }); });
  const cfg = (n, players) => ({ name: n, short: n, players, games: [{ id: "g1", opp: "Rivals", title: "G1" }], events: [{ id: "p1", type: "practice", start: "2099-11-03T18:00", dur: 90 }] });
  await call(state, "POST", "/api/state", { kind: "config", team: "a", config: cfg("Alpha", [{ id: "ann", name: "Ann" }, { id: "bea", name: "Bea" }]), code: "master-code" });
  await call(state, "POST", "/api/state", { kind: "config", team: "b", config: cfg("Beta", [{ id: "cal", name: "Cal" }]), code: "master-code" });
  await call(state, "POST", "/api/state", { kind: "setcode", team: "a", newCode: "code-a", code: "master-code" });
  admin = (await api("POST", "", { kind: "join", team: "b", code: "master-code", name: "Darren" })).j;
  coach = (await api("POST", "", { kind: "join", team: "a", code: "code-a", name: "Coach A" })).j;
  const inv = (await api("POST", "", { kind: "invite", team: "a" }, coach.token)).j.code;
  pat = (await api("POST", "", { kind: "join", invite: inv, name: "Pat", kids: ["ann"] })).j;
  quinn = (await api("POST", "", { kind: "join", invite: inv, name: "Quinn", kids: [] })).j;
  const invB = (await api("POST", "", { kind: "invite", team: "b" }, admin.token)).j.code;
  rae = (await api("POST", "", { kind: "join", invite: invB, name: "Rae", kids: ["cal"] })).j;
  for (const [m, n] of [[admin, "admin"], [coach, "coach"], [pat, "pat"], [quinn, "quinn"], [rae, "rae"]]) await api("POST", "", { kind: "pushsub", sub: sub(n) }, m.token);
});
const to = (name) => sent.filter((x) => x.to.endsWith("/" + name));

test("team chat notifies the team (not the sender, not other teams), with a link to the chat", async () => {
  await api("POST", "", { kind: "send", ch: "t.a", text: "Bring water" }, pat.token);
  assert.deepEqual(sent.map((x) => x.to.split("/").pop()).sort(), ["coach", "quinn"]);
  assert.equal(to("coach")[0].title, "Pat · Alpha");
  assert.equal(to("coach")[0].url, "https://club.test/?team=a&msg=t.a");
});

test("announcements reach everyone; people can turn a kind off", async () => {
  await api("POST", "", { kind: "pushprefs", prefs: { news: false } }, rae.token);
  await api("POST", "", { kind: "send", ch: "club", text: "Tryouts Saturday" }, admin.token);
  assert.deepEqual(sent.map((x) => x.to.split("/").pop()).sort(), ["coach", "pat", "quinn"]);
  assert.equal(sent[0].title, "Club announcement");
});

test("new fee notifies only the parents of players who owe it", async () => {
  await api("POST", "", { kind: "fee", feeKind: "tournament", title: "KICKS", amount: 45, scope: { type: "team", team: "a" }, due: "2026-11-01" }, coach.token);
  assert.deepEqual(sent.map((x) => x.to.split("/").pop()), ["pat"], "Quinn has no player linked yet; Rae is on another team");
  assert.match(sent[0].body, /\$45\.00, due 2026-11-01/);
});

test("kickoff and final go out once each; an official result with a new score goes out too", async () => {
  const g = (o) => call(state, "POST", "/api/state", { kind: "game", team: "a", gid: "g1", game: o, code: "code-a" });
  await g({ started: false, goals: [] });
  await g({ started: true, goals: [] });
  await g({ started: true, goals: [{ side: "us", t: 1 }] });
  await g({ started: true, fullDone: true, goals: [{ side: "us", t: 1 }] });
  await g({ started: true, fullDone: true, goals: [{ side: "us", t: 1 }] });
  const titles = to("pat").map((x) => x.title);
  assert.deepEqual(titles, ["Kickoff: Alpha vs Rivals", "Final: Alpha 1–0 Rivals"]);
  await call(state, "POST", "/api/state", { kind: "final", team: "a", gid: "g1", final: { us: 1, them: 0, src: "SincSports" }, code: "code-a" });
  assert.equal(to("pat").length, 2, "same score as the final: no second alert");
  await call(state, "POST", "/api/state", { kind: "final", team: "a", gid: "g1", final: { us: 2, them: 0, src: "SincSports" }, code: "master-code" });
  assert.equal(to("pat").at(-1).title, "Official result: Alpha 2–0 Rivals");
  assert.equal(to("rae").length, 0, "other team's parents don't get it");
});

test("cancelling a practice alerts the team", async () => {
  const cur = (await call(state, "GET", "/api/state?team=a")).json.config.team;
  cur.events[0].cancelled = true;
  await call(state, "POST", "/api/state", { kind: "config", team: "a", config: cur, code: "code-a" });
  assert.equal(to("pat")[0].title, "Alpha: cancelled");
  assert.match(to("pat")[0].body, /Practice Tue, Nov 3, 6:00 PM/);
});

test("dead devices are forgotten", async () => {
  await api("POST", "", { kind: "pushsub", sub: sub("dead") }, pat.token);
  await api("POST", "", { kind: "send", ch: "t.a", text: "hi" }, coach.token);
  const rec = await db().get("push-" + pat.me.id, { type: "json" });
  assert.deepEqual(rec.subs.map((s) => s.endpoint.split("/").pop()), ["pat"]);
});

test("linking families: coach links a parent to a player, parents add siblings, admins manage roles", async () => {
  let r = await api("GET", "?roster=a", null, coach.token);
  assert.deepEqual(r.j.families.map((f) => f.name).sort(), ["Pat", "Quinn"]);
  assert.deepEqual(r.j.players.find((p) => p.id === "ann").parents.map((p) => p.name), ["Pat"]);
  assert.equal((await api("GET", "?roster=a", null, pat.token)).status, 403);
  assert.equal((await api("POST", "", { kind: "link", member: quinn.me.id, team: "a", player: "bea" }, coach.token)).status, 200);
  assert.equal((await api("POST", "", { kind: "link", member: rae.me.id, team: "a", player: "bea" }, coach.token)).status, 403, "coach can't pull in a parent from another team");
  assert.equal((await api("POST", "", { kind: "link", member: rae.me.id, team: "a", player: "bea" }, admin.token)).status, 200, "admin can (siblings across teams)");
  r = await api("GET", "?roster=a", null, coach.token);
  assert.deepEqual(r.j.players.find((p) => p.id === "bea").parents.map((p) => p.name).sort(), ["Quinn", "Rae"]);
  // Parent adds a sibling on their own team, but can't add kids on a team they haven't joined.
  assert.equal((await api("POST", "", { kind: "addkid", team: "a", player: "bea" }, pat.token)).status, 200);
  assert.equal((await api("POST", "", { kind: "addkid", team: "b", player: "cal" }, pat.token)).status, 403);
  // Roles: only admins; can't remove the last admin.
  assert.equal((await api("POST", "", { kind: "role", member: quinn.me.id, role: "coach", team: "a" }, coach.token)).status, 403);
  assert.equal((await api("POST", "", { kind: "role", member: quinn.me.id, role: "coach", team: "a" }, admin.token)).status, 200);
  assert.equal((await api("POST", "", { kind: "role", member: admin.me.id, role: "parent" }, admin.token)).status, 409);
  // Coach removes a family from the team; can't remove a coach.
  assert.equal((await api("POST", "", { kind: "offteam", member: quinn.me.id, team: "a" }, coach.token)).status, 403, "Quinn is a coach now");
  assert.equal((await api("POST", "", { kind: "offteam", member: pat.me.id, team: "a" }, coach.token)).status, 200);
  assert.equal((await api("GET", "?roster=a", null, coach.token)).j.players.find((p) => p.id === "ann").parents.length, 0);
  // Admin removes someone: their device is signed out.
  assert.equal((await api("POST", "", { kind: "remove", member: rae.me.id }, admin.token)).status, 200);
  assert.equal((await api("GET", "?me=1", null, rae.token)).status, 401);
});
