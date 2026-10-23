// Voice (or typed) plan changes: a coach says what they want, Claude rewrites the plan, the coach approves it.
// Claude's answer is constrained to real players, real positions and real drills; the app checks it again before
// showing the changes, and nothing is saved until the coach taps Apply.

const S = (o) => ({ type: "object", additionalProperties: false, required: Object.keys(o), properties: o });
const str = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

// ----- Game rotation plan -----
export function cleanGameCtx(c) {
  c = c || {};
  const positions = (Array.isArray(c.positions) ? c.positions : []).slice(0, 11).map((p) => ({ id: str(p.id, 6), name: str(p.name, 30) })).filter((p) => /^[A-Za-z0-9]{1,6}$/.test(p.id));
  const players = (Array.isArray(c.players) ? c.players : []).slice(0, 40).map((p) => ({ id: str(p.id, 40), name: str(p.name, 30), num: str(p.num, 4), role: str(p.role, 60),
    groups: (Array.isArray(p.groups) ? p.groups : []).slice(0, 4).map((g) => str(g, 4)), guest: !!p.guest, out: !!p.out })).filter((p) => /^[A-Za-z0-9_-]{1,40}$/.test(p.id));
  const ids = new Set(players.map((p) => p.id)), pos = new Set(positions.map((p) => p.id));
  const blocks = (Array.isArray(c.blocks) ? c.blocks : []).slice(0, 16).map((b, i) => ({ i, label: str(b.label, 30), locked: !!b.locked,
    lineup: Object.fromEntries(Object.entries(b.lineup || {}).filter(([k, v]) => pos.has(k) && (v === "" || ids.has(v)))) }));
  return { team: str(c.team, 80), opp: str(c.opp, 80), format: str(c.format, 10), half: Math.max(5, Math.min(60, +c.half || 30)), sub: Math.max(2, Math.min(30, +c.sub || 10)),
    started: !!c.started, positions, players, blocks };
}
export function gameSchema(ctx) {
  const ids = ctx.players.map((p) => p.id);
  const slot = { type: "string", enum: [...ids, ""] };
  return S({
    possible: { type: "boolean" },
    message: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
    out: { type: "array", items: { type: "string", enum: ids.length ? ids : [""] } },
    blocks: { type: "array", items: S(Object.fromEntries(ctx.positions.map((p) => [p.id, slot]))) },
  });
}
export function gameSystem(ctx) {
  const pl = ctx.players.map((p) => `- ${p.id}: ${p.name}${p.num ? " #" + p.num : ""}${p.role ? " (" + p.role + ")" : ""}${p.groups.length ? " [" + p.groups.join("/") + "]" : ""}${p.guest ? " guest" : ""}${p.out ? " OUT (not available)" : ""}`).join("\n");
  const bl = ctx.blocks.map((b) => `Block ${b.i + 1} (${b.label})${b.locked ? " LOCKED, already played or on now; copy it exactly" : ""}: ` + ctx.positions.map((p) => `${p.id}=${b.lineup[p.id] || "(empty)"}`).join(", ")).join("\n");
  return `You edit a youth soccer team's rotation plan for one game, following the coach's spoken request.
The game: ${ctx.team} vs ${ctx.opp || "opponent"}, ${ctx.format}, halves of ${ctx.half} minutes, a new block every ${ctx.sub} minutes. ${ctx.started ? "The game has started." : "The game hasn't started."}
Positions (id: name): ${ctx.positions.map((p) => p.id + ": " + p.name).join(", ")}
Players (use these ids):
${pl}

Current plan, ${ctx.blocks.length} blocks:
${bl}

Rules:
- Return all ${ctx.blocks.length} blocks in order, every position filled with a player id, or "" only if there truly aren't enough players.
- A player can be in only one position per block. Don't use players who are OUT unless the coach says they're back.
- Copy LOCKED blocks exactly.
- Change only what the coach asked for, plus the fewest other moves needed to keep it working. Keep playing time as even as the request allows, avoid anyone sitting two blocks in a row, and keep players in positions that fit their role.
- "out": the ids of everyone who should be marked not available for this game (keep the current OUT players unless the coach says otherwise).
- "changes": short plain sentences describing what you changed, e.g. "Olivia plays GK in every block." "Block 3: Vivi in at RM for Emmie."
- If the request can't be done or is unclear, set possible to false, return the plan unchanged, and say why in "message". Otherwise "message" is one short sentence.`;
}
// Check Claude's plan before the coach sees it. Returns { blocks, out, warnings } or { error }.
export function checkGamePlan(ctx, r) {
  if (!r || !Array.isArray(r.blocks)) return { error: "The AI's plan came back incomplete. Try again." };
  if (r.blocks.length !== ctx.blocks.length) return { error: `The AI returned ${r.blocks.length} blocks instead of ${ctx.blocks.length}. Try saying it another way.` };
  const ids = new Set(ctx.players.map((p) => p.id));
  const out = [...new Set((r.out || []).filter((id) => ids.has(id)))];
  const warnings = [];
  const blocks = r.blocks.map((b, i) => {
    if (ctx.blocks[i].locked) return { ...ctx.blocks[i].lineup };
    const lineup = {}, seen = new Map();
    ctx.positions.forEach((p) => { const v = ids.has(b[p.id]) ? b[p.id] : ""; lineup[p.id] = v; });
    Object.entries(lineup).forEach(([pos, v]) => { if (!v) return; if (seen.has(v)) warnings.push(`Block ${i + 1}: ${nameOf(ctx, v)} was in two spots; ${pos} left empty.`), (lineup[pos] = ""); else seen.set(v, pos); });
    Object.entries(lineup).forEach(([pos, v]) => { if (v && out.includes(v)) warnings.push(`Block ${i + 1}: ${nameOf(ctx, v)} is marked out but is in the plan at ${pos}.`); });
    return lineup;
  });
  return { blocks, out, warnings };
}
const nameOf = (ctx, id) => (ctx.players.find((p) => p.id === id) || {}).name || id;

// ----- Practice plan -----
export function cleanPracticeCtx(c) {
  c = c || {};
  const drills = (Array.isArray(c.drills) ? c.drills : []).slice(0, 150).map((d) => ({ id: str(d.id, 60), title: str(d.title, 80), topic: str(d.topic, 30), min: Math.max(0, Math.min(60, +d.min || 0)), players: str(d.players, 20), summary: str(d.summary, 160) })).filter((d) => d.id);
  const blocks = (Array.isArray(c.blocks) ? c.blocks : []).slice(0, 30).map((b) => ({ title: str(b.title, 120), min: Math.max(0, Math.min(120, +b.min || 0)), drill: str(b.drill, 60), notes: str(b.notes, 600) }));
  return { team: str(c.team, 80), format: str(c.format, 10), group: str(c.group, 60), title: str(c.title, 120), focus: str(c.focus, 200), date: str(c.date, 16),
    attending: Math.max(0, Math.min(40, +c.attending || 0)), roster: Math.max(0, Math.min(40, +c.roster || 0)), blocks, drills };
}
export function practiceSchema(ctx) {
  return S({
    possible: { type: "boolean" }, message: { type: "string" }, changes: { type: "array", items: { type: "string" } },
    title: { type: "string" }, focus: { type: "string" },
    blocks: { type: "array", items: S({ title: { type: "string" }, min: { type: "integer" }, drill: { type: "string", enum: [...ctx.drills.map((d) => d.id), ""] }, notes: { type: "string" } }) },
  });
}
export function practiceSystem(ctx) {
  const total = ctx.blocks.reduce((t, b) => t + b.min, 0);
  return `You edit a youth soccer practice plan, following the coach's spoken request.
Team: ${ctx.team}${ctx.group ? " (" + ctx.group + ")" : ""}, ${ctx.format}. ${ctx.attending ? ctx.attending + " players coming" : ctx.roster + " players on the roster"}.
Practice: "${ctx.title || "Practice"}"${ctx.focus ? ", focus: " + ctx.focus : ""}${ctx.date ? ", " + ctx.date : ""}. ${total} minutes now.
Current blocks:
${ctx.blocks.map((b, i) => `${i + 1}. ${b.title || "(untitled)"}, ${b.min} min${b.drill ? ", drill " + b.drill : ""}${b.notes ? ", notes: " + b.notes : ""}`).join("\n") || "(none yet)"}

Drill library (id: title, topic, minutes, players):
${ctx.drills.map((d) => `${d.id}: ${d.title} (${d.topic}, ${d.min} min, ${d.players})`).join("\n")}

Rules:
- Return the whole plan: every block with title, minutes, drill id from the library (or "" for a block that isn't a library drill, like a scrimmage or water break) and notes.
- Use the library drill's title for its block unless the coach names it differently. Prefer drills that suit the team's format and how many players are coming.
- Change only what the coach asked for. Keep the total length unless they ask to change it or it obviously has to change.
- Keep the coach's own notes unless asked to change them.
- "changes": short plain sentences, e.g. "Swapped Passing Gates for 4v4 to Four Goals." "Scrimmage is now 20 minutes."
- If the request can't be done or is unclear, set possible to false, return the plan unchanged, and say why in "message". Otherwise "message" is one short sentence.`;
}
export function checkPracticePlan(ctx, r) {
  if (!r || !Array.isArray(r.blocks)) return { error: "The AI's plan came back incomplete. Try again." };
  const ids = new Set(ctx.drills.map((d) => d.id));
  const blocks = r.blocks.slice(0, 30).map((b) => ({ title: str(b.title, 120) || "Block", min: Math.max(0, Math.min(120, Math.round(+b.min || 0))), drill: ids.has(b.drill) ? b.drill : "", notes: str(b.notes, 2000) }));
  return { blocks, title: str(r.title, 120), focus: str(r.focus, 200), warnings: [] };
}

export const historyMessages = (history) => (Array.isArray(history) ? history : []).slice(-3).flatMap((h) =>
  h && h.q && h.a ? [{ role: "user", content: str(h.q, 1000) }, { role: "assistant", content: str(typeof h.a === "string" ? h.a : JSON.stringify(h.a), 8000) }] : []);
