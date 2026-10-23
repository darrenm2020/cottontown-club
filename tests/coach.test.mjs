import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { call } from "./helpers.mjs";
import { _reset, getStore } from "./blobs-mock.mjs";
const { default: state } = await import("../netlify/functions/state.mjs");
const { handle } = await import("../netlify/functions/coach.mjs");
const { ASK_SCHEMA, PLAY_SCHEMA, COMMITTEE } = await import("../netlify/lib/committee.mjs");

const db = () => getStore({ name: "cottontown" });
const ask = (body, client) => handle(new Request("https://t/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { store: db(), client });
const reply = (obj, extra = {}) => ({ stop_reason: "end_turn", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(obj) }], ...extra });
const fake = (respond) => { const calls = []; return { calls, beta: { messages: { create: async (p) => { calls.push({ beta: true, p }); return respond(p, calls.length); } } }, messages: { create: async (p) => { calls.push({ beta: false, p }); return respond(p, calls.length); } } }; };

const ANSWER = { members: [{ id: "grassroots", answer: "Play 4v4." }, { id: "bogus", answer: "x" }, { id: "mindset", answer: "Praise effort." }],
  chair: { summary: "Small games.", session: [{ name: "4v4", minutes: 20, setup: "Two grids", points: ["Scan", "Move"] }] } };

beforeEach(async () => {
  _reset();
  await call(state, "POST", "/api/state", { kind: "config", team: "t1", config: { name: "Test FC", sub: "U10 Girls", format: "7v7", formation: "2-3-1", players: [{ id: "a" }, { id: "b" }], games: [] }, code: "master-code" });
  await call(state, "POST", "/api/state", { kind: "setcode", team: "t1", newCode: "team-code", code: "master-code" });
});

test("committee answer: coaches only, structured output, fallback on, cleaned, usage counted", async () => {
  const f = fake(() => reply(ANSWER));
  assert.equal((await ask({ team: "t1", question: "Help", mode: "ask" }, f)).status, 401);
  const r = await ask({ team: "t1", code: "team-code", question: "My U10s bunch up", mode: "ask", members: ["grassroots", "nope"] }, f);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.result.members.map((m) => m.id), ["grassroots", "mindset"], "unknown members dropped");
  const p = f.calls[0].p;
  assert.equal(f.calls[0].beta, true);
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.fallbacks, "default");
  assert.equal(p.model, "claude-opus-5-5");
  assert.deepEqual(p.thinking, { type: "adaptive" });
  assert.equal(p.output_config.format.type, "json_schema");
  assert.deepEqual(p.output_config.format.schema, ASK_SCHEMA);
  assert.match(p.system, /fictional/);
  assert.match(p.system, /Format: 7v7/);
  assert.match(p.messages.at(-1).content, /hear from: grassroots\.\)/);
  assert.equal(j.left, 149);
});

test("follow-up questions send earlier turns", async () => {
  const f = fake(() => reply(ANSWER));
  await ask({ team: "t1", code: "team-code", question: "Shorter please", history: [{ q: "First", a: ANSWER }] }, f);
  const m = f.calls[0].p.messages;
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
});

test("if the beta request is rejected (AI Gateway), it retries without fallback headers", async () => {
  const f = fake((p, n) => { if (n === 1) throw new Anthropic.BadRequestError(400, { type: "error" }, "unknown beta", new Headers()); return reply(ANSWER); });
  const r = await ask({ team: "t1", code: "team-code", question: "Q" }, f);
  assert.equal(r.status, 200);
  assert.equal(f.calls[1].beta, false);
  assert.equal(f.calls[1].p.fallbacks, undefined);
});

test("refusals, missing key and monthly limit give friendly errors", async () => {
  let r = await ask({ team: "t1", code: "team-code", question: "Q" }, fake(() => ({ stop_reason: "refusal", content: [] })));
  assert.equal(r.status, 422);
  r = await ask({ team: "t1", code: "team-code", question: "Q" }, fake(() => { throw new Anthropic.AuthenticationError(401, {}, "no key", new Headers()); }));
  assert.equal(r.status, 503);
  await db().setJSON("ai-usage-t1-" + new Date().toISOString().slice(0, 7), { n: 150 });
  r = await ask({ team: "t1", code: "team-code", question: "Q" }, fake(() => reply(ANSWER)));
  assert.equal(r.status, 429);
});

test("play mode: board schema, coordinates kept on the field, unknown objects dropped", async () => {
  const play = { title: "Overlap", field: "half", notes: "", objects: [{ id: "lb", kind: "us", label: "LB" }, { id: "b", kind: "ball", label: "" }],
    steps: [{ caption: "Go", pos: [{ id: "lb", x: 120, y: -5 }, { id: "ghost", x: 1, y: 1 }, { id: "b", x: 50, y: 50 }], arrows: [{ kind: "run", from: { x: 10, y: 80 }, to: { x: 10, y: 20 } }] }] };
  const f = fake(() => reply(play));
  const j = await (await ask({ team: "t1", code: "team-code", question: "2v1 overlap on the left", mode: "play" }, f)).json();
  assert.deepEqual(f.calls[0].p.output_config.format.schema, PLAY_SCHEMA);
  assert.equal(f.calls[0].p.output_config.effort, "medium");
  assert.deepEqual(j.result.steps[0].pos, [{ id: "lb", x: 100, y: 0 }, { id: "b", x: 50, y: 50 }]);
});

test("committee list is public and names are all fictional characters", async () => {
  const r = await handle(new Request("https://t/api/coach?committee=1"), { store: db() });
  const j = await r.json();
  assert.equal(j.members.length, 8);
  assert.equal(new Set(COMMITTEE.map((m) => m.id)).size, 8);
});
