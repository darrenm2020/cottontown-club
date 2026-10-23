import { getStore } from "@netlify/blobs";

// Shared state for the game tracker (multiple teams).
// GET  /api/state?team=ID   -> { now, team, config:{rev,team}|null, games:{gid:{rev,game}}, legacy }
// GET  /api/state?list=1    -> { now, teams:[{id,name}] }
// GET  /api/state?club=1    -> { now, club, teams:[ summary of every team and game ] }
// POST /api/state  { kind:'verify',  team, code }
//                  { kind:'config',  team, config, code }   (creating a new team needs the main code)
//                  { kind:'game',    team, gid, game, code }
//                  { kind:'setcode', team, newCode, code }  (sets a team-only coach code)
//                  { kind:'club',    club:{name,logo}, code } (main code only)
//                  { kind:'pstat',   team, gid, stat:{id,k,t,u,dv} }  (no code: parents add positive stats only)
//                  { kind:'pstatdel', team, gid, u, dv, code? }  (the device that added it, or a coach)
// Parent stats live in their own blob (pstats-TEAM-GID) so coach game saves never overwrite them.
// The main code is the COACH_CODE environment variable and works for every team.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const masterCode = () =>
  (globalThis.Netlify?.env?.get?.("COACH_CODE") ?? process.env.COACH_CODE ?? "").trim();

const okId = (s) => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s);
const okGid = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(s);

const POSITIVE = new Set(["sot", "kp", "pass", "tackle", "slide", "int", "clr", "blk", "cross", "drib", "fwon", "save", "catch", "dist"]);
const okTok = (s) => typeof s === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(s);

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tracker:" + s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authLevel(store, team, code) {
  code = String(code ?? "").trim();
  if (!code) return null;
  const m = masterCode();
  if (m && code === m) return "master";
  const a = await store.get("auth-" + team, { type: "json" });
  if (a && a.hash && a.hash === (await sha(code))) return "team";
  return null;
}

function summarize(g, pname) {
  const goals = Array.isArray(g.goals) ? g.goals : [];
  return {
    started: !!g.started, running: !!g.running, acc: g.acc || 0, runStart: g.runStart || 0, half: g.half || 30,
    ot: g.ot || null, fullDone: !!g.fullDone, stops: Array.isArray(g.stops) ? g.stops : [],
    us: goals.filter((x) => x.side === "us").length, them: goals.filter((x) => x.side === "them").length,
    pk: g.pk ? { us: (g.pk.us || []).filter((k) => k.made).length, them: (g.pk.them || []).filter(Boolean).length } : null,
    scorers: goals.filter((x) => x.side === "us").map((x) => ({ t: x.t, by: x.by ? pname[x.by] || "" : "" })),
  };
}

export default async (req) => {
  const store = getStore({ name: "cottontown", consistency: "strong" });
  const now = Date.now();
  const url = new URL(req.url);

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    if (!masterCode()) return json({ error: "COACH_CODE is not set in Netlify" }, 500);
    const team = b && b.team ? b.team : "cottontown";
    if (!okId(team)) return json({ error: "bad team" }, 400);
    const kind = b.kind || (b.verify ? "verify" : "");

    if (kind === "pstat" || kind === "pstatdel") {
      if (!okGid(b.gid)) return json({ error: "bad request" }, 400);
      const cfg = await store.get("team-" + team, { type: "json" });
      const games = (cfg && cfg.team && Array.isArray(cfg.team.games)) ? cfg.team.games : [];
      if (!games.some((g) => g && g.id === b.gid)) return json({ error: "no such game" }, 404);
      const key = "pstats-" + team + "-" + b.gid;
      const list = (await store.get(key, { type: "json" })) || [];
      if (kind === "pstat") {
        const s = b.stat || {};
        const players = Array.isArray(cfg.team.players) ? cfg.team.players : [];
        if (!POSITIVE.has(s.k) || !okTok(s.id) || !players.some((p) => p && p.id === s.id) || !okTok(s.u) || !okTok(s.dv)) return json({ error: "bad stat" }, 400);
        const t = Math.max(0, Math.min(4 * 3600000, Math.round(Number(s.t) || 0)));
        if (list.length >= 3000) return json({ error: "too many" }, 413);
        if (!list.some((x) => x.u === s.u)) list.push({ id: s.id, k: s.k, t, u: s.u, dv: s.dv, at: now });
        await store.setJSON(key, list);
        return json({ ok: true, now, n: list.length });
      }
      const coach = b.code ? await authLevel(store, team, b.code) : null;
      const i = list.findIndex((x) => x.u === b.u && (coach || x.dv === b.dv));
      if (i < 0) return json({ error: "not found" }, 404);
      list.splice(i, 1);
      await store.setJSON(key, list);
      return json({ ok: true, now });
    }

    const who = await authLevel(store, team, b.code);
    if (!who) return json({ error: "wrong code" }, 401);

    if (kind === "verify") return json({ ok: true, now, master: who === "master" });

    if (kind === "config") {
      if (!b.config || typeof b.config !== "object") return json({ error: "bad request" }, 400);
      if (JSON.stringify(b.config).length > 1500000) return json({ error: "too large" }, 413);
      const cur = await store.get("team-" + team, { type: "json" });
      if (!cur && who !== "master") return json({ error: "only the main code can create teams" }, 403);
      const rev = ((cur && cur.rev) || 0) + 1;
      await store.setJSON("team-" + team, { rev, team: b.config, at: now });
      const idx = (await store.get("teams", { type: "json" })) || [];
      const name = String(b.config.name || team).slice(0, 80);
      const i = idx.findIndex((t) => t.id === team);
      if (i < 0) idx.push({ id: team, name }); else idx[i].name = name;
      await store.setJSON("teams", idx);
      return json({ ok: true, now, rev });
    }

    if (kind === "game") {
      if (!okGid(b.gid) || !b.game || typeof b.game !== "object") return json({ error: "bad request" }, 400);
      if (JSON.stringify(b.game).length > 400000) return json({ error: "too large" }, 413);
      const key = "game-" + team + "-" + b.gid;
      const cur = await store.get(key, { type: "json" });
      const rev = ((cur && cur.rev) || 0) + 1;
      await store.setJSON(key, { rev, game: b.game, at: now });
      return json({ ok: true, now, rev });
    }

    if (kind === "club") {
      if (who !== "master") return json({ error: "only the main code can edit the club" }, 403);
      const c = b.club || {};
      const club = { name: String(c.name || "").slice(0, 80), logo: typeof c.logo === "string" && c.logo.length < 400000 ? c.logo : null };
      await store.setJSON("club", club);
      return json({ ok: true, now });
    }

    if (kind === "setcode") {
      const nc = String(b.newCode ?? "").trim();
      if (nc.length < 4) return json({ error: "code must be at least 4 characters" }, 400);
      await store.setJSON("auth-" + team, { hash: await sha(nc) });
      return json({ ok: true, now });
    }

    return json({ error: "bad request" }, 400);
  }

  if (url.searchParams.get("club")) {
    const idx = (await store.get("teams", { type: "json" })) || [];
    if (!idx.some((t) => t.id === "cottontown")) idx.unshift({ id: "cottontown", name: "Cottontown United" });
    const club = await store.get("club", { type: "json" });
    const teams = await Promise.all(
      idx.slice(0, 40).map(async (t) => {
        const cfg = await store.get("team-" + t.id, { type: "json" });
        if (!cfg || !cfg.team) return { id: t.id, name: t.name, games: [] };
        const c = cfg.team;
        const pname = {};
        (c.players || []).forEach((p) => (pname[p.id] = p.name));
        const games = await Promise.all(
          (c.games || []).slice(0, 80).map(async (g) => {
            const v = g && okGid(g.id) ? await store.get("game-" + t.id + "-" + g.id, { type: "json" }) : null;
            return { id: g.id, title: g.title || "", oppLogo: typeof g.oppLogo === "string" ? g.oppLogo : "", opp: g.opp || "", dt: g.dt || "", when: g.when || "", field: g.field || "", place: g.place || "", event: typeof g.event === "string" ? g.event.slice(0, 60) : "",
              half: g.half || 30, s: v && v.game ? summarize(v.game, pname) : null };
          })
        );
        return { id: t.id, name: c.name || t.name, short: c.short || "", sub: c.sub || "", logo: c.logo || null, format: c.format || "", placing: c.placing || null, games };
      })
    );
    return json({ now, club: club || null, teams });
  }

  if (url.searchParams.get("list")) {
    const idx = (await store.get("teams", { type: "json" })) || [];
    if (!idx.some((t) => t.id === "cottontown")) idx.unshift({ id: "cottontown", name: "Cottontown United" });
    return json({ now, teams: idx });
  }

  const team = url.searchParams.get("team") || "cottontown";
  if (!okId(team)) return json({ error: "bad team" }, 400);
  const config = await store.get("team-" + team, { type: "json" });
  const games = {};
  const pstats = {};
  if (config && config.team && Array.isArray(config.team.games)) {
    await Promise.all(
      config.team.games.slice(0, 80).map(async (g) => {
        if (!g || !okGid(g.id)) return;
        const [v, ps] = await Promise.all([
          store.get("game-" + team + "-" + g.id, { type: "json" }),
          g.imported ? null : store.get("pstats-" + team + "-" + g.id, { type: "json" }),
        ]);
        if (v) games[g.id] = v;
        if (ps && ps.length) pstats[g.id] = ps.map((x) => ({ id: x.id, k: x.k, t: x.t, u: x.u }));
      })
    );
  }
  // Games saved by the earlier single-team version, so nothing is lost on upgrade.
  let legacy = null;
  if (team === "cottontown") {
    const old = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => store.get("game-" + i, { type: "json" })));
    legacy = old.map((x) => (x && x.game ? x.game : null));
    if (!legacy.some(Boolean)) legacy = null;
  }
  return json({ now, team, config: config || null, games, pstats, legacy });
};

export const config = { path: "/api/state" };
