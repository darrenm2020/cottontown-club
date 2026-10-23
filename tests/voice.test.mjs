import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.mjs";
import { _reset, getStore } from "./blobs-mock.mjs";
const { default: state } = await import("../netlify/functions/state.mjs");
const { handle } = await import("../netlify/functions/voice.mjs");

const db = () => getStore({ name: "cottontown" });
const fake = (obj) => { const f = { p: null }; const create = async (p) => { f.p = p; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] }; }; f.beta = { messages: { create } }; f.messages = { create }; return f; };
const ask = (body, client) => handle(new Request("https://t/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { store: db(), client });
const P = ["GK", "LB", "RB"];
const ctx = { team: "Test", opp: "Rivals", format: "4v4", half: 20, sub: 10, started: true,
  positions: P.map((id) => ({ id, name: id })),
  players: ["olivia", "emmie", "vivi", "june", "shalome"].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), groups: [] })).map((p) => p.id === "shalome" ? { ...p, out: true } : p),
  blocks: [{ label: "0–10", locked: true, lineup: { GK: "june", LB: "emmie", RB: "vivi" } }, { label: "10–20", lineup: { GK: "june", LB: "olivia", RB: "vivi" } }, { label: "20–30", lineup: { GK: "june", LB: "emmie", RB: "olivia" } }] };

beforeEach(async () => {
  _reset();
  await call(state, "POST", "/api/state", { kind: "config", team: "t1", config: { name: "Test", players: [], games: [] }, code: "master-code" });
});

test("game plan: coaches only, Claude sees the plan and roster, answer limited to real players and positions", async () => {
  const f = fake({ possible: true, message: "Olivia is in goal.", changes: ["Olivia plays GK"], out: ["shalome"], blocks: [{ GK: "olivia", LB: "olivia", RB: "vivi" }, { GK: "olivia", LB: "emmie", RB: "vivi" }, { GK: "olivia", LB: "olivia", RB: "june" }] });
  assert.equal((await ask({ team: "t1", kind: "game", request: "Olivia in goal", ctx }, f)).status, 401);
  const r = await (await ask({ team: "t1", code: "master-code", kind: "game", request: "Olivia in goal the rest of the game", ctx }, f)).json();
  assert.equal(r.possible, true);
  assert.deepEqual(r.plan.blocks[0], ctx.blocks[0].lineup, "the block already played can't change");
  assert.deepEqual(r.plan.blocks[1], { GK: "olivia", LB: "emmie", RB: "vivi" });
  assert.deepEqual(r.plan.blocks[2], { GK: "olivia", LB: "", RB: "june" }, "a player in two spots is caught");
  assert.match(r.plan.warnings.join(" "), /Olivia was in two spots/);
  const schema = f.p.output_config.format.schema;
  assert.deepEqual(schema.properties.blocks.items.properties.GK.enum, ["olivia", "emmie", "vivi", "june", "shalome", ""]);
  assert.match(f.p.system, /Block 1 \(0–10\) LOCKED/);
  assert.match(f.p.system, /shalome: Shalome OUT/);
  assert.equal(f.p.output_config.effort, "medium");
});

test("game plan: wrong number of blocks is rejected; 'not possible' passes the reason through", async () => {
  let r = await ask({ team: "t1", code: "master-code", kind: "game", request: "x", ctx }, fake({ possible: true, message: "", changes: [], out: [], blocks: [{ GK: "olivia", LB: "emmie", RB: "vivi" }] }));
  assert.equal(r.status, 502);
  r = await (await ask({ team: "t1", code: "master-code", kind: "game", request: "Put Zoe in goal", ctx }, fake({ possible: false, message: "There's no Zoe on the roster.", changes: [], out: [], blocks: [] }))).json();
  assert.deepEqual([r.possible, r.message], [false, "There's no Zoe on the roster."]);
});

test("practice plan: drills limited to the library; minutes and titles cleaned", async () => {
  const pctx = { team: "Test", format: "9v9", title: "Tuesday", blocks: [{ title: "Passing Gates", min: 15, drill: "pass-gates" }, { title: "Scrimmage", min: 30, drill: "" }],
    drills: [{ id: "pass-gates", title: "Passing Gates", topic: "passing", min: 15, players: "6+" }, { id: "four-goals", title: "4v4 Four Goals", topic: "small-sided", min: 20, players: "8+" }] };
  const f = fake({ possible: true, message: "Swapped.", changes: ["Swapped Passing Gates for 4v4 Four Goals"], title: "Tuesday", focus: "", blocks: [{ title: "4v4 Four Goals", min: 15, drill: "four-goals", notes: "" }, { title: "Scrimmage", min: 300, drill: "made-up", notes: "" }] });
  const r = await (await ask({ team: "t1", code: "master-code", kind: "practice", request: "swap the passing drill for a 4v4", ctx: pctx }, f)).json();
  assert.deepEqual(r.plan.blocks.map((b) => [b.drill, b.min]), [["four-goals", 15], ["", 120]]);
  assert.deepEqual(f.p.output_config.format.schema.properties.blocks.items.properties.drill.enum, ["pass-gates", "four-goals", ""]);
});

test("voice requests count toward the team's monthly AI limit", async () => {
  await db().setJSON("ai-usage-t1-" + new Date().toISOString().slice(0, 7), { n: 150 });
  assert.equal((await ask({ team: "t1", code: "master-code", kind: "game", request: "x", ctx }, fake({}))).status, 429);
});
