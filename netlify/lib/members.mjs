// Club members and who they are. Today a device proves who it is with a private token it got when the person
// joined (coaches with their coach code, parents with a team invite link). When sign-in (Clerk) is added, only
// whoami() changes: the member records, roles and teams stay the same.

export const okId = (s) => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s);
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "").trim();
const rand = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); };
export const newId = (p) => p + Date.now().toString(36) + rand(3);
export async function sha(s, salt = "tracker:") {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Same check the game tracker uses: the main code (COACH_CODE) or the team's own coach code.
export async function codeLevel(store, team, code) {
  code = String(code ?? "").trim();
  if (!code) return null;
  const m = env("COACH_CODE");
  if (m && code === m) return "master";
  if (!okId(team)) return null;
  const a = await store.get("auth-" + team, { type: "json" });
  return a && a.hash && a.hash === (await sha(code)) ? "team" : null;
}

export const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
export const pub = (m) => m && { id: m.id, name: m.name, role: m.role, teams: m.teams || [], kids: m.kids || [] };
export const isAdmin = (m) => m && m.role === "admin";
export const isCoachOf = (m, team) => m && (m.role === "admin" || (m.role === "coach" && (m.teams || []).includes(team)));
export const inTeam = (m, team) => m && (m.role === "admin" || (m.teams || []).includes(team));

export async function getMember(store, id) { return id ? store.get("mem-" + id, { type: "json" }) : null; }
export async function saveMember(store, m) {
  await store.setJSON("mem-" + m.id, m);
  const idx = (await store.get("members", { type: "json" })) || [];
  const i = idx.findIndex((x) => x.id === m.id);
  const row = pub(m);
  if (i < 0) idx.push(row); else idx[i] = row;
  await store.setJSON("members", idx);
}
export async function allMembers(store) { return (await store.get("members", { type: "json" })) || []; }

async function issueToken(store, memberId) {
  const token = rand(24);
  await store.setJSON("tok-" + (await sha(token, "tok:")), { id: memberId, at: Date.now() });
  return token;
}

export async function whoami(store, req) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok || tok.length > 200) return null;
  const t = await store.get("tok-" + (await sha(tok, "tok:")), { type: "json" });
  return t ? getMember(store, t.id) : null;
}

// Coaches join with their coach code; the main code makes a club admin.
export async function joinWithCode(store, { team, code, name }, me) {
  const lvl = await codeLevel(store, team, code);
  if (!lvl) return { error: "wrong code", status: 401 };
  // A device that already joined (proved by its token) is upgraded; otherwise a new member is made.
  let m = me || { id: newId("m"), name: cleanName(name) || "Coach", role: "coach", teams: [], kids: [], at: Date.now() };
  if (lvl === "master") m.role = "admin";
  else if (m.role === "parent") m.role = "coach";
  if (okId(team) && !m.teams.includes(team)) m.teams.push(team);
  if (name) m.name = cleanName(name) || m.name;
  await saveMember(store, m);
  return { member: m, token: await issueToken(store, m.id) };
}

// Parents join with a team invite link and say which player(s) are theirs.
export async function createInvite(store, me, team) {
  if (!isCoachOf(me, team)) return { error: "coaches only", status: 403 };
  const code = rand(5);
  await store.setJSON("inv-" + code, { team, by: me.id, at: Date.now(), uses: 0 });
  return { code };
}
export async function readInvite(store, code) {
  if (!/^[a-f0-9]{10}$/.test(String(code || ""))) return null;
  const inv = await store.get("inv-" + code, { type: "json" });
  if (!inv || inv.off) return null;
  const cfg = await store.get("team-" + inv.team, { type: "json" });
  const t = (cfg && cfg.team) || {};
  return { team: inv.team, teamName: t.name || inv.team, players: (t.players || []).filter((p) => !p.guest).map((p) => ({ id: p.id, name: p.name })) };
}
export async function joinWithInvite(store, { invite, name, kids }, me) {
  const info = await readInvite(store, invite);
  if (!info) return { error: "This invite link has expired. Ask your coach for a new one.", status: 404 };
  const nm = cleanName(name);
  if (!nm) return { error: "Add your name", status: 400 };
  const ids = new Set(info.players.map((p) => p.id));
  const picked = (Array.isArray(kids) ? kids : []).filter((k) => ids.has(k)).slice(0, 6);
  let m = me || { id: newId("m"), name: nm, role: "parent", teams: [], kids: [], at: Date.now() };
  m.name = nm;
  if (!m.teams.includes(info.team)) m.teams.push(info.team);
  picked.forEach((pid) => { if (!m.kids.some((k) => k.team === info.team && k.player === pid)) m.kids.push({ team: info.team, player: pid, name: info.players.find((p) => p.id === pid).name }); });
  await saveMember(store, m);
  const inv = await store.get("inv-" + invite, { type: "json" });
  if (inv) { inv.uses = (inv.uses || 0) + 1; await store.setJSON("inv-" + invite, inv); }
  return { member: m, token: await issueToken(store, m.id) };
}

// ---- Linking families to teams and players ----
async function teamPlayers(store, team) { const v = await store.get("team-" + team, { type: "json" }); return ((v && v.team && v.team.players) || []); }
async function loadAll(store) { return (await Promise.all((await allMembers(store)).map((m) => getMember(store, m.id)))).filter(Boolean); }

// A team's roster with the parents linked to each player, plus coaches and families not linked to anyone yet.
export async function roster(store, me, team) {
  if (!okId(team) || !isCoachOf(me, team)) return { error: "Only this team's coaches can see this", status: 403 };
  const players = await teamPlayers(store, team);
  const all = await loadAll(store);
  const onTeam = all.filter((m) => (m.teams || []).includes(team));
  const parentsOf = (pid) => all.filter((m) => (m.kids || []).some((k) => k.team === team && k.player === pid)).map((m) => ({ id: m.id, name: m.name }));
  return {
    players: players.map((p) => ({ id: p.id, name: p.name, num: p.num || "", guest: !!p.guest, parents: parentsOf(p.id) })),
    coaches: onTeam.filter((m) => m.role !== "parent").map((m) => ({ id: m.id, name: m.name, role: m.role })),
    families: onTeam.filter((m) => m.role === "parent").map((m) => ({ id: m.id, name: m.name, kids: (m.kids || []).filter((k) => k.team === team).map((k) => k.name) })),
    // Admins can link any parent in the club (siblings on other teams); coaches pick from their own team.
    pickable: (isAdmin(me) ? all : onTeam).map((m) => ({ id: m.id, name: m.name, role: m.role, teams: m.teams || [] })),
  };
}
export async function link(store, me, { member, team, player }, on) {
  if (!okId(team) || !isCoachOf(me, team)) return { error: "Only this team's coaches can do that", status: 403 };
  const m = await getMember(store, member);
  if (!m) return { error: "That person isn't in the club", status: 404 };
  if (!isAdmin(me) && !(m.teams || []).includes(team)) return { error: "They need to join this team first (send them the invite link)", status: 403 };
  const p = (await teamPlayers(store, team)).find((x) => x.id === player);
  if (!p) return { error: "No such player", status: 404 };
  m.kids = m.kids || [];
  if (on) {
    if (!m.teams.includes(team)) m.teams.push(team);
    if (!m.kids.some((k) => k.team === team && k.player === player)) m.kids.push({ team, player, name: p.name });
  } else m.kids = m.kids.filter((k) => !(k.team === team && k.player === player));
  await saveMember(store, m);
  return { member: pub(m) };
}
// Take someone off a team (their players there too). Coaches can remove families; only admins remove coaches.
export async function removeFromTeam(store, me, { member, team }) {
  if (!okId(team) || !isCoachOf(me, team)) return { error: "Only this team's coaches can do that", status: 403 };
  const m = await getMember(store, member);
  if (!m) return { error: "not found", status: 404 };
  if (m.role !== "parent" && !isAdmin(me)) return { error: "Only a club admin can remove a coach", status: 403 };
  m.teams = (m.teams || []).filter((t) => t !== team);
  m.kids = (m.kids || []).filter((k) => k.team !== team);
  await saveMember(store, m);
  return { member: pub(m) };
}
export async function setRole(store, me, { member, role, team }) {
  if (!isAdmin(me)) return { error: "Only a club admin can change roles", status: 403 };
  if (!["parent", "coach", "admin"].includes(role)) return { error: "bad role", status: 400 };
  const m = await getMember(store, member);
  if (!m) return { error: "not found", status: 404 };
  if (m.role === "admin" && role !== "admin") {
    const admins = (await allMembers(store)).filter((x) => x.role === "admin");
    if (admins.length <= 1) return { error: "The club needs at least one admin", status: 409 };
  }
  m.role = role;
  if (okId(team) && !m.teams.includes(team)) m.teams.push(team);
  await saveMember(store, m);
  return { member: pub(m) };
}
export async function removeMember(store, me, { member }) {
  if (!isAdmin(me)) return { error: "Only a club admin can remove people", status: 403 };
  if (member === me.id) return { error: "You can't remove yourself", status: 400 };
  const m = await getMember(store, member);
  if (!m) return { error: "not found", status: 404 };
  await store.delete("mem-" + m.id);
  const idx = (await allMembers(store)).filter((x) => x.id !== m.id);
  await store.setJSON("members", idx);
  return { ok: true };
}
export async function listMembers(store, me) {
  if (!isAdmin(me)) return { error: "Only a club admin can see everyone", status: 403 };
  return { members: (await loadAll(store)).map(pub).sort((a, b) => a.name.localeCompare(b.name)) };
}
// Parents add or remove their own players on teams they've joined (siblings on the same team).
export async function myKid(store, me, { team, player }, on) {
  if (!okId(team) || !(me.teams || []).includes(team)) return { error: "Join that team first with its invite link", status: 403 };
  const p = (await teamPlayers(store, team)).find((x) => x.id === player);
  if (!p) return { error: "No such player", status: 404 };
  me.kids = (me.kids || []).filter((k) => !(k.team === team && k.player === player));
  if (on) me.kids.push({ team, player, name: p.name });
  await saveMember(store, me);
  return { member: pub(me) };
}
