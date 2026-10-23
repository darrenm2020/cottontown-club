import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.mjs";
import { _reset } from "./blobs-mock.mjs";
const { default: state } = await import("../netlify/functions/state.mjs");
const post = (b) => call(state, "POST", "/api/state", { team: "t1", code: "team-code", ...b });
const goal = (side, u) => ({ side, t: 1000, u });
const cfg = (games) => ({ name: "Test", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], games: games.map((id) => ({ id, title: id })) });

beforeEach(async () => {
  _reset();
  await call(state, "POST", "/api/state", { kind: "config", team: "t1", config: cfg(["g1"]), code: "master-code" });
  await call(state, "POST", "/api/state", { kind: "setcode", team: "t1", newCode: "team-code", code: "master-code" });
});

test("a save that wipes a game is snapshotted, and a coach can restore it", async () => {
  await post({ kind: "game", gid: "g1", game: { started: true, acc: 900000, goals: [goal("us", "g1"), goal("us", "g2"), goal("them", "g3")], events: [{ t: 1 }] } });
  await post({ kind: "game", gid: "g1", game: { started: false, acc: 0, goals: [], events: [] } }); // the accidental reset
  const h = (await post({ kind: "history", gid: "g1" })).json.history;
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].sum.us, h[0].sum.them, h[0].why], [2, 1, "before a save that removed data"]);
  const r = await post({ kind: "restore", gid: "g1", at: h[0].at });
  assert.equal(r.status, 200);
  const team = await call(state, "GET", "/api/state?team=t1");
  assert.equal(team.json.games.g1.game.goals.length, 3);
  assert.equal(team.json.games.g1.game.started, true);
  // The wiped version is kept too, so the restore itself can be undone.
  const h2 = (await post({ kind: "history", gid: "g1" })).json.history;
  assert.equal(h2[0].why, "before a restore");
});

test("restoring marks newer items deleted so stale phones can't merge them back", async () => {
  await post({ kind: "game", gid: "g1", game: { started: true, goals: [goal("us", "a1")] } });
  await post({ kind: "game", gid: "g1", game: { started: true, goals: [] } }); // removed a goal -> snapshot with 1 goal
  await post({ kind: "game", gid: "g1", game: { started: true, goals: [goal("us", "x9"), goal("them", "x8")] } });
  const h = (await post({ kind: "history", gid: "g1" })).json.history;
  const oneGoal = h.find((x) => x.sum.goals === 1);
  const r = await post({ kind: "restore", gid: "g1", at: oneGoal.at });
  assert.deepEqual(r.json.game.goals.map((x) => x.u), ["a1"]);
  assert.deepEqual(r.json.game.del.sort(), ["x8", "x9"]);
});

test("ordinary saves only snapshot every few minutes", async () => {
  for (let i = 1; i <= 5; i++) await post({ kind: "game", gid: "g1", game: { started: true, goals: Array.from({ length: i }, (_, k) => goal("us", "u" + k)) } });
  assert.equal((await post({ kind: "history", gid: "g1" })).json.history.length, 1);
});

test("team setup: deleting a game snapshots the setup; restore brings it back", async () => {
  await post({ kind: "config", config: cfg(["g1", "g2"]) });
  await post({ kind: "config", config: cfg(["g1"]) }); // a game deleted by mistake
  const h = (await post({ kind: "history" })).json.history;
  const two = h.find((x) => x.sum.games === 2);
  assert.ok(two, "setup with both games was kept");
  await post({ kind: "restore", at: two.at });
  const team = await call(state, "GET", "/api/state?team=t1");
  assert.deepEqual(team.json.config.team.games.map((g) => g.id), ["g1", "g2"]);
});

test("history needs a coach code", async () => {
  assert.equal((await call(state, "POST", "/api/state", { kind: "history", team: "t1", gid: "g1" })).status, 401);
  assert.equal((await call(state, "POST", "/api/state", { kind: "restore", team: "t1", gid: "g1", at: 1 })).status, 401);
});
