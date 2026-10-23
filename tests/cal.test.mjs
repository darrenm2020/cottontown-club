import { test } from "node:test";
import assert from "node:assert/strict";
import { call } from "./helpers.mjs";
import { _reset } from "./blobs-mock.mjs";
const { default: state } = await import("../netlify/functions/state.mjs");
const { default: cal, buildCalendar } = await import("../netlify/functions/cal.mjs");

const team = {
  name: "Cottontown United 13/14 Girls", short: "Cottontown 13/14",
  games: [{ id: "g3", title: "CRWA Red", opp: "CRWA Red G2012/13", dt: "2099-10-24T08:00", field: "RSSC 09", place: "Rush Soccer Complex, Nashville", half: 35, event: "Fall Classic" },
    { id: "old", opp: "Ancient", dt: "2000-01-01T08:00" }, { id: "tbd", opp: "No time yet", dt: "" }],
  events: [{ id: "p1", type: "practice", title: "Practice", start: "2099-10-27T23:30", dur: 90, place: "Field 3" },
    { id: "p2", type: "practice", start: "2099-10-29T18:00", dur: 60, place: "Field 3", cancelled: true },
    { id: "e1", type: "event", title: "Team photos", start: "2099-11-01T10:00", dur: 30 }],
};

test("calendar has games and practices with the right local times, and skips old or undated games", () => {
  const ics = buildCalendar([{ id: "t1", team }], "https://example.app", Date.parse("2099-10-20T12:00:00Z"));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20991024T080000\r\nDTEND:20991024T092500/, "35-min halves + 15 = 85 min");
  assert.match(ics, /SUMMARY:⚽ Cottontown 13\/14 vs CRWA Red G2012\/13/);
  assert.match(ics, /LOCATION:RSSC 09\\, Rush Soccer Complex\\, Nashville/);
  assert.match(ics, /DTSTART:20991027T233000\r\nDTEND:20991028T010000/, "practice crossing midnight");
  assert.match(ics, /SUMMARY:CANCELLED: Cottontown 13\/14 practice\r\n[\s\S]*?STATUS:CANCELLED/);
  assert.match(ics, /SUMMARY:Cottontown 13\/14: Team photos/);
  assert.doesNotMatch(ics, /Ancient|No time yet/);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, "line too long: " + line);
});

test("feed endpoint serves several teams and rejects bad links", async () => {
  _reset();
  await call(state, "POST", "/api/state", { kind: "config", team: "t1", config: team, code: "master-code" });
  await call(state, "POST", "/api/state", { kind: "config", team: "t2", config: { name: "Other", games: [{ id: "g1", opp: "X", dt: "2099-11-02T09:00" }] }, code: "master-code" });
  const r = await call(cal, "GET", "/api/cal?t=t1,t2");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/calendar/);
  assert.match(r.text, /X-WR-CALNAME:My teams/);
  assert.match(r.text, /Other vs X/);
  assert.equal((await call(cal, "GET", "/api/cal")).status, 400);
  assert.equal((await call(cal, "GET", "/api/cal?t=nope")).status, 404);
});
