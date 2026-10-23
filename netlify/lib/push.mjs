import webpush from "web-push";

// Web push notifications (works on iPhone once the app is added to the Home Screen, and on Android/desktop).
// The VAPID keys are made on first use and kept in Blobs, so there's nothing to set up in Netlify.
// Each member chooses what they get: msg (team chat and direct messages), news (club announcements),
// fees, games (kickoff and final scores), sched (cancelled practices and events).
export const KINDS = ["msg", "news", "fees", "games", "sched"];
let send = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);
export const _setSender = (f) => { send = f; };

export async function vapid(store) {
  let v = await store.get("vapid", { type: "json" });
  if (!v || !v.publicKey) { v = webpush.generateVAPIDKeys(); await store.setJSON("vapid", v); }
  return v;
}
export async function saveSub(store, me, sub, prefs) {
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return { error: "bad subscription", status: 400 };
  const k = "push-" + me.id;
  const cur = (await store.get(k, { type: "json" })) || { subs: [], prefs: {} };
  cur.subs = cur.subs.filter((s) => s.endpoint !== sub.endpoint);
  cur.subs.push({ endpoint: sub.endpoint.slice(0, 1000), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }, at: Date.now() });
  cur.subs = cur.subs.slice(-6); // a few devices per person
  if (prefs) cur.prefs = cleanPrefs(prefs);
  await store.setJSON(k, cur);
  return { ok: true, prefs: cur.prefs, devices: cur.subs.length };
}
const cleanPrefs = (p) => Object.fromEntries(KINDS.map((k) => [k, p[k] !== false]));
export async function setPrefs(store, me, prefs) {
  const k = "push-" + me.id;
  const cur = (await store.get(k, { type: "json" })) || { subs: [], prefs: {} };
  cur.prefs = cleanPrefs(prefs || {});
  await store.setJSON(k, cur);
  return { ok: true, prefs: cur.prefs, devices: cur.subs.length };
}
export async function getPrefs(store, me) {
  const cur = (await store.get("push-" + me.id, { type: "json" })) || { subs: [], prefs: {} };
  return { prefs: cleanPrefs(cur.prefs || {}), devices: cur.subs.length };
}
export async function removeSub(store, me, endpoint) {
  const k = "push-" + me.id;
  const cur = await store.get(k, { type: "json" });
  if (!cur) return { ok: true };
  cur.subs = cur.subs.filter((s) => s.endpoint !== endpoint);
  await store.setJSON(k, cur);
  return { ok: true, devices: cur.subs.length };
}

// Send one notification to each member's devices (if they want this kind). Dead devices are forgotten.
export async function notify(store, memberIds, kind, payload, origin) {
  const ids = [...new Set(memberIds)].filter(Boolean).slice(0, 500);
  if (!ids.length) return { sent: 0 };
  const v = await vapid(store);
  const opts = { TTL: 6 * 3600, timeout: 5000, urgency: kind === "games" ? "high" : "normal",
    vapidDetails: { subject: origin && /^https:/.test(origin) ? origin : "mailto:support@example.com", publicKey: v.publicKey, privateKey: v.privateKey } };
  const body = JSON.stringify({ ...payload, url: payload.url && origin ? origin + payload.url : payload.url || "/" });
  let sent = 0;
  await Promise.allSettled(ids.map(async (id) => {
    const k = "push-" + id;
    const rec = await store.get(k, { type: "json" });
    if (!rec || !rec.subs.length || (rec.prefs && rec.prefs[kind] === false)) return;
    const dead = [];
    await Promise.allSettled(rec.subs.map(async (s) => {
      try { await send(s, body, opts); sent++; }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.endpoint); }
    }));
    if (dead.length) { rec.subs = rec.subs.filter((s) => !dead.includes(s.endpoint)); await store.setJSON(k, rec); }
  }));
  return { sent };
}

// Members of a team (families and coaches), from the members index.
export async function teamMemberIds(store, team, { exclude } = {}) {
  const idx = (await store.get("members", { type: "json" })) || [];
  return idx.filter((m) => (m.teams || []).includes(team) && m.id !== exclude).map((m) => m.id);
}
