import { okId, newId, isAdmin, isCoachOf, inTeam, getMember } from "./members.mjs";
import { notify, teamMemberIds } from "./push.mjs";

// Message channels: "club" (announcements, admins post), "coaches", "t.TEAM" (a team's families and coaches),
// and "dm.A.B" (two members, ids sorted). Each message is its own blob, so two people posting at once
// never overwrite each other.

export const dmId = (a, b) => "dm." + [a, b].sort().join(".");
const memberIdOk = (s) => typeof s === "string" && /^m[a-z0-9]{6,30}$/.test(s);
export function parseCh(ch) {
  if (ch === "club" || ch === "coaches") return { type: ch };
  let m = /^t\.([a-z0-9-]{1,40})$/.exec(ch || "");
  if (m) return { type: "team", team: m[1] };
  m = /^dm\.(m[a-z0-9]{6,30})\.(m[a-z0-9]{6,30})$/.exec(ch || "");
  if (m && m[1] < m[2]) return { type: "dm", a: m[1], b: m[2] };
  return null;
}
const isCoach = (me) => me && (me.role === "coach" || me.role === "admin");
const shareTeam = (a, b) => (a.teams || []).some((t) => (b.teams || []).includes(t));
// Who may message whom directly: admins anyone; coaches each other; anyone who shares a team.
export function canDM(me, other) {
  if (!me || !other || me.id === other.id) return false;
  if (isAdmin(me) || isAdmin(other)) return true;
  if (isCoach(me) && isCoach(other)) return true;
  return shareTeam(me, other);
}
export async function canRead(store, me, ch) {
  const c = parseCh(ch);
  if (!c || !me) return false;
  if (c.type === "club") return true;
  if (c.type === "coaches") return isCoach(me);
  if (c.type === "team") return inTeam(me, c.team);
  return me.id === c.a || me.id === c.b;
}
export async function canPost(store, me, ch) {
  const c = parseCh(ch);
  if (!c || !me) return false;
  if (c.type === "club") return isAdmin(me);
  if (c.type === "coaches") return isCoach(me);
  if (c.type === "team") return inTeam(me, c.team);
  if (me.id !== c.a && me.id !== c.b) return false;
  const other = await getMember(store, me.id === c.a ? c.b : c.a);
  return canDM(me, other);
}

const pad = (n) => n.toString(36).padStart(9, "0");
export async function send(store, me, ch, text, opts = {}) {
  text = String(text || "").replace(/\r/g, "").trim().slice(0, 2000);
  if (!text) return { error: "Empty message", status: 400 };
  if (!(await canPost(store, me, ch))) return { error: "You can't post here", status: 403 };
  const at = Date.now();
  const msg = { id: pad(at) + "-" + newId("").slice(-6), ch, from: me.id, name: me.name, role: me.role, text, at };
  await store.setJSON("m/" + ch + "/" + msg.id, msg);
  await store.setJSON("chm-" + ch, { last: { at, from: me.id, name: me.name, text: text.slice(0, 120) } });
  const c = parseCh(ch);
  if (c.type === "dm") for (const id of [c.a, c.b]) {
    const k = "dmidx-" + id; const idx = (await store.get(k, { type: "json" })) || [];
    if (!idx.includes(ch)) { idx.push(ch); await store.setJSON(k, idx); }
  }
  await pushFor(store, me, c, ch, text, opts);
  return { message: msg };
}
// Tell everyone who reads this channel (except the sender), if they turned notifications on.
async function pushFor(store, me, c, ch, text, { origin, teamName } = {}) {
  try {
    const idx = (await store.get("members", { type: "json" })) || [];
    let ids, kind = "msg", title = me.name, url = "/?msg=" + encodeURIComponent(ch);
    if (c.type === "club") { ids = idx.map((m) => m.id); kind = "news"; title = "Club announcement"; }
    else if (c.type === "coaches") { ids = idx.filter((m) => m.role !== "parent").map((m) => m.id); title = me.name + " · Coaches"; }
    else if (c.type === "team") { ids = await teamMemberIds(store, c.team); title = me.name + " · " + (teamName || "Team chat"); url = "/?team=" + encodeURIComponent(c.team) + "&msg=" + encodeURIComponent(ch); }
    else ids = [me.id === c.a ? c.b : c.a];
    await notify(store, ids.filter((id) => id !== me.id), kind, { title, body: text.slice(0, 160), tag: ch, url }, origin);
  } catch (e) { /* a notification failing never stops the message */ }
}
export async function list(store, me, ch, since) {
  if (!(await canRead(store, me, ch))) return { error: "You can't read this", status: 403 };
  const { blobs } = await store.list({ prefix: "m/" + ch + "/" });
  let keys = blobs.map((b) => b.key).sort();
  if (since) keys = keys.filter((k) => k.slice(k.lastIndexOf("/") + 1) > since);
  keys = keys.slice(-60);
  const msgs = (await Promise.all(keys.map((k) => store.get(k, { type: "json" })))).filter(Boolean);
  const pin = await store.get("pin-" + ch, { type: "json" });
  return { messages: msgs.map((m) => (m.deleted ? { id: m.id, deleted: true, at: m.at } : m)), pin: pin || null };
}
export async function remove(store, me, ch, id) {
  const c = parseCh(ch);
  if (!c || !/^[a-z0-9]{9}-[a-z0-9]{1,8}$/.test(String(id || ""))) return { error: "bad request", status: 400 };
  const k = "m/" + ch + "/" + id;
  const m = await store.get(k, { type: "json" });
  if (!m) return { error: "not found", status: 404 };
  const mod = m.from === me.id || isAdmin(me) || (c.type === "team" && isCoachOf(me, c.team));
  if (!mod) return { error: "Only the sender or a coach can remove this", status: 403 };
  await store.setJSON(k, { id: m.id, ch, at: m.at, deleted: true, by: me.id });
  return { ok: true };
}
export async function pin(store, me, ch, text) {
  const c = parseCh(ch);
  const ok = c && (isAdmin(me) || (c.type === "team" && isCoachOf(me, c.team)) || (c.type === "coaches" && isCoach(me)));
  if (!ok) return { error: "Only coaches and admins can pin", status: 403 };
  if (!text) { await store.delete("pin-" + ch); return { ok: true }; }
  await store.setJSON("pin-" + ch, { text: String(text).slice(0, 300), by: me.name, at: Date.now() });
  return { ok: true };
}
// Every channel this member can see, newest first, with unread flags.
export async function inbox(store, me, teamNames) {
  const chans = [{ ch: "club", title: "Club announcements" }];
  if (isCoach(me)) chans.push({ ch: "coaches", title: "Club coaches" });
  const teams = isAdmin(me) ? Object.keys(teamNames) : (me.teams || []);
  teams.forEach((t) => okId(t) && chans.push({ ch: "t." + t, title: (teamNames[t] || t) + " team" }));
  const dms = (await store.get("dmidx-" + me.id, { type: "json" })) || [];
  for (const ch of dms) {
    const c = parseCh(ch); if (!c) continue;
    const other = await getMember(store, me.id === c.a ? c.b : c.a);
    chans.push({ ch, title: other ? other.name : "Former member", dm: true, with: other ? other.id : null });
  }
  const read = me.read || {};
  const out = await Promise.all(chans.map(async (x) => {
    const meta = await store.get("chm-" + x.ch, { type: "json" });
    const last = meta && meta.last;
    return { ...x, last: last || null, unread: !!(last && last.from !== me.id && last.at > (read[x.ch] || 0)) };
  }));
  return out.sort((a, b) => (b.last ? b.last.at : 0) - (a.last ? a.last.at : 0));
}
export { memberIdOk };
