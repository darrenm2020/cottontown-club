import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.mjs";
import { _reset } from "./blobs-mock.mjs";
const { default: state } = await import("../netlify/functions/state.mjs");

const M = "master-code";
const cfg = { name: "Test FC", players: [{ id: "a", name: "Ann" }], games: [{ id: "g1", title: "G1", opp: "Opp", dt: "2026-10-24T09:00" }] };
const game = (us, them, extra = {}) => ({ goals: [...Array(us)].map(() => ({ side: "us", t: 1 })).concat([...Array(them)].map(() => ({ side: "them", t: 1 }))), started: true, running: true, fullDone: false, ...extra });

beforeEach(async () => {
  _reset();
  await call(state, "POST", "/api/state", { kind: "config", team: "t1", config: cfg, code: M });
  await call(state, "POST", "/api/state", { kind: "setcode", team: "t1", newCode: "team-code", code: M });
});

test("official result overrides the tracked score on the club page and team load", async () => {
  await call(state, "POST", "/api/state", { kind: "game", team: "t1", gid: "g1", game: game(1, 1), code: "team-code" });
  const r = await call(state, "POST", "/api/state", { kind: "final", team: "t1", gid: "g1", final: { us: 3, them: 2, src: "SincSports" }, code: "team-code" });
  assert.equal(r.status, 200);
  const club = await call(state, "GET", "/api/state?club=1");
  const s = club.json.teams.find((t) => t.id === "t1").games[0].s;
  assert.deepEqual([s.us, s.them, s.fullDone, s.running, s.official.src], [3, 2, true, false, "SincSports"]);
  const team = await call(state, "GET", "/api/state?team=t1");
  assert.equal(team.json.locks.g1.us, 3);
  assert.equal(team.json.games.g1.game.running, false, "confirming stops a running clock");
});

test("a stale phone saving a running game can't un-finish a locked game", async () => {
  await call(state, "POST", "/api/state", { kind: "final", team: "t1", gid: "g1", final: { us: 2, them: 0, src: "Referee" }, code: "team-code" });
  const r = await call(state, "POST", "/api/state", { kind: "game", team: "t1", gid: "g1", game: game(0, 0), code: "team-code" });
  assert.equal(r.json.locked, true);
  const club = await call(state, "GET", "/api/state?club=1");
  const s = club.json.teams.find((t) => t.id === "t1").games[0].s;
  assert.deepEqual([s.us, s.them, s.fullDone, s.running], [2, 0, true, false]);
});

test("only the main code can change or remove an official result", async () => {
  await call(state, "POST", "/api/state", { kind: "final", team: "t1", gid: "g1", final: { us: 2, them: 0, src: "Referee" }, code: "team-code" });
  const r1 = await call(state, "POST", "/api/state", { kind: "final", team: "t1", gid: "g1", final: { us: 5, them: 0, src: "Referee" }, code: "team-code" });
  assert.equal(r1.status, 403);
  const r2 = await call(state, "POST", "/api/state", { kind: "final", team: "t1", gid: "g1", final: null, code: "team-code" });
  assert.equal(r2.status, 403);
  const r3 = await call(state, "POST", "/api/state", { kind: "final", team: "t1", gid: "g1", final: null, code: M });
  assert.equal(r3.status, 200);
  const team = await call(state, "GET", "/api/state?team=t1");
  assert.equal(team.json.locks.g1, undefined);
});

test("no code, no official result", async () => {
  const r = await call(state, "POST", "/api/state", { kind: "final", team: "t1", gid: "g1", final: { us: 9, them: 0 } });
  assert.equal(r.status, 401);
});
