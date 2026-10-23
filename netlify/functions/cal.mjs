import { getStore } from "@netlify/blobs";

// Calendar feed for one or more teams, for "Subscribe" in Apple, Google or Outlook Calendar.
// GET /api/cal?t=TEAM[,TEAM2...]  -> text/calendar with games and practices/events
// Times are stored as local wall-clock times ("2026-10-24T09:00"), so they're written as floating
// times: every calendar shows them at that local time.

const okId = (s) => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s);
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

// "2026-10-24T09:00" + minutes -> "20261024T090000" (calendar math only, no time zones involved)
function stamp(dt, addMin = 0) {
  const m = LOCAL.exec(dt || "");
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + addMin * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}
// Lines longer than 75 bytes are folded, as the calendar format requires.
function fold(line) {
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildCalendar(teams, origin, nowMs) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Team Tracker//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc(teams.length === 1 ? teams[0].team.short || teams[0].team.name : "My teams"),
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  const dtstamp = stamp(new Date(nowMs).toISOString().slice(0, 16)) + "Z";
  const since = new Date(nowMs - 120 * 864e5).toISOString().slice(0, 10);
  const ev = (o) => {
    L.push("BEGIN:VEVENT", "UID:" + o.uid, "DTSTAMP:" + dtstamp, "DTSTART:" + o.start, "DTEND:" + o.end, fold("SUMMARY:" + esc(o.title)));
    if (o.loc) L.push(fold("LOCATION:" + esc(o.loc)));
    if (o.desc) L.push(fold("DESCRIPTION:" + esc(o.desc)));
    if (o.url) L.push(fold("URL:" + o.url));
    if (o.cancelled) L.push("STATUS:CANCELLED");
    L.push("END:VEVENT");
  };
  for (const { id, team: c } of teams) {
    const name = c.short || c.name || id;
    for (const g of c.games || []) {
      if (!g || !g.dt || g.dt.slice(0, 10) < since) continue;
      const start = stamp(g.dt);
      if (!start) continue;
      const len = 2 * (Number(g.half) || 30) + 15;
      const loc = [g.field, g.place].filter(Boolean).join(", ");
      ev({ uid: `${id}-game-${g.id}@team-tracker`, start, end: stamp(g.dt, len), title: `⚽ ${name} vs ${g.opp || g.title || "TBD"}`, loc,
        desc: [g.event, g.field && "Field: " + g.field, g.note, origin && "Follow live: " + origin + "/?team=" + id + "&game=" + g.id].filter(Boolean).join("\n"),
        url: origin ? origin + "/?team=" + id + "&game=" + g.id : "" });
    }
    for (const e of c.events || []) {
      if (!e || !e.start || e.start.slice(0, 10) < since) continue;
      const start = stamp(e.start);
      if (!start) continue;
      const kind = e.type === "practice" ? "Practice" : e.title || "Team event";
      const title = (e.cancelled ? "CANCELLED: " : "") + (e.type === "practice" ? `${name} practice` : `${name}: ${kind}`);
      ev({ uid: `${id}-ev-${e.id}@team-tracker`, start, end: stamp(e.start, Number(e.dur) || 90), title, loc: e.place || "",
        desc: [e.type === "practice" && e.title && e.title !== "Practice" ? e.title : "", e.note].filter(Boolean).join("\n"), cancelled: !!e.cancelled });
    }
  }
  L.push("END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}

export default async (req) => {
  const url = new URL(req.url);
  const ids = String(url.searchParams.get("t") || url.searchParams.get("team") || "").split(",").map((s) => s.trim()).filter(okId).slice(0, 10);
  if (!ids.length) return new Response("Add ?t=TEAM to the link", { status: 400 });
  const store = getStore({ name: "cottontown", consistency: "strong" });
  const teams = (await Promise.all(ids.map(async (id) => {
    const v = await store.get("team-" + id, { type: "json" });
    return v && v.team ? { id, team: v.team } : null;
  }))).filter(Boolean);
  if (!teams.length) return new Response("No such team", { status: 404 });
  return new Response(buildCalendar(teams, url.origin, Date.now()), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="schedule.ics"', "Cache-Control": "public, max-age=300" },
  });
};

export const config = { path: "/api/cal" };
