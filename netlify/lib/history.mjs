// Undo history for games and team setups, so a coach can restore an earlier version without code changes.
// Each save may snapshot the version it replaces: always when the save loses data (fewer goals, a reset clock,
// fewer games or players), otherwise at most every few minutes. The newest 40 snapshots are kept.

const KEEP = 40;
const gameCounts = (g) => ({ goals: (g.goals || []).length, stats: (g.stats || []).length, saves: (g.saves || []).length, events: (g.events || []).length,
  started: !!g.started, done: !!g.fullDone, acc: g.acc || 0 });
export function gameSummary(g) {
  const goals = g.goals || [];
  return { us: goals.filter((x) => x.side === "us").length, them: goals.filter((x) => x.side === "them").length, ...gameCounts(g) };
}
// True when the new game has less in it than the old one: the kind of save people need to undo.
export function gameLosesData(oldG, newG) {
  const a = gameCounts(oldG), b = gameCounts(newG);
  return b.goals < a.goals || b.stats < a.stats || b.saves < a.saves || b.events < a.events || (a.started && !b.started) || (a.done && !b.done) || b.acc + 60000 < a.acc;
}
export const cfgSummary = (c) => ({ name: c.name || "", games: (c.games || []).length, players: (c.players || []).length, events: (c.events || []).length, plays: (c.plays || []).length });
export function cfgLosesData(oldC, newC) {
  const a = cfgSummary(oldC), b = cfgSummary(newC);
  return b.games < a.games || b.players < a.players || b.events < a.events || b.plays < a.plays;
}

export async function snapshot(store, key, entry, { force, minGapMs }) {
  const list = (await store.get(key, { type: "json" })) || [];
  const last = list[list.length - 1];
  if (!force && last && entry.at - last.at < minGapMs) return false;
  list.push(entry);
  await store.setJSON(key, list.slice(-KEEP));
  return true;
}
export async function listHistory(store, key) {
  const list = (await store.get(key, { type: "json" })) || [];
  return list.map((h) => ({ at: h.at, rev: h.rev, by: h.by || "", why: h.why || "", sum: h.sum })).reverse();
}
export async function getSnapshot(store, key, at) {
  const list = (await store.get(key, { type: "json" })) || [];
  return list.find((h) => h.at === at) || null;
}
// Items in the current game that aren't in the restored one are marked deleted, so phones still holding
// them don't merge them back in.
export function restoreGame(snapshotGame, currentGame) {
  const g = JSON.parse(JSON.stringify(snapshotGame));
  const keep = new Set(["goals", "stats", "saves"].flatMap((k) => (g[k] || []).map((x) => x.u)).filter(Boolean));
  const gone = ["goals", "stats", "saves"].flatMap((k) => ((currentGame && currentGame[k]) || []).map((x) => x.u)).filter((u) => u && !keep.has(u));
  g.del = [...new Set([...(g.del || []).filter((u) => !keep.has(u)), ...gone])];
  return g;
}
