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
