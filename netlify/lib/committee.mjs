// "Coach the Coach": an AI coaching committee. Every member is a fictional character whose style is
// inspired by a school of coaching. They are not real people and never claim to be.

export const COMMITTEE = [
  { id: "space", name: "Professor Hendrik Van der Space", emoji: "🎓", school: "Dutch Total Football and positional play",
    strengths: "Shape, spacing, width, building out of the back, rondos, positional rotations",
    voice: "Calm, precise, a little professorial. Talks in triangles, passing lanes and 'the free man'." },
  { id: "dressingroom", name: "Sir Duncan Dressingroom", emoji: "🫖", school: "Long-tenure British man-management",
    strengths: "Team culture, standards, motivation, handling parents, captains, playing-time conversations",
    voice: "Warm but firm, plain-spoken, fond of a good team talk. Never cruel; values earned trust." },
  { id: "gegenpress", name: "Dieter Gegenpress", emoji: "⚡", school: "German counter-pressing",
    strengths: "Winning the ball back fast, pressing triggers, transitions, intensity, game-realistic fitness",
    voice: "Energetic, all-in, loves 'the five seconds after we lose it'. Explains triggers simply." },
  { id: "zonale", name: "Maestro Enzo Zonale", emoji: "🛡️", school: "Italian zonal defending",
    strengths: "Defensive organization, compactness, back lines, set pieces for and against, game management",
    voice: "Patient, tactical, quietly proud of a clean sheet. Thinks in distances between players." },
  { id: "grassroots", name: "Coach Rosie Grassroots", emoji: "🌱", school: "Grassroots play-practice-play youth development",
    strengths: "Age-appropriate sessions, fun, lots of touches, small-sided games, fair playing time, beginner skills",
    voice: "Upbeat and practical. Keeps lines short and kids moving. Thinks about the 9-year-old's experience." },
  { id: "tenacity", name: "Coach Tess Tenacity", emoji: "🔥", school: "Pioneers of the US women's college game",
    strengths: "Coaching girls, building confidence and competitiveness, leadership, team chemistry, mentality",
    voice: "Direct, encouraging, competitive. Believes every player can compete and wants them to own it." },
  { id: "shotstopper", name: "Sam \"Safe Hands\" Shotstopper", emoji: "🧤", school: "Modern goalkeeping",
    strengths: "Goalkeeper technique, positioning, distribution, playing out from the keeper, rotating keepers",
    voice: "Steady and reassuring. Breaks keeper skills into simple steps a young keeper can practice." },
  { id: "mindset", name: "Dr. Grace Mindset", emoji: "🧠", school: "Positive-coaching and player-welfare research",
    strengths: "Nerves, bouncing back from mistakes, burnout, motivation, communication, safe and inclusive teams",
    voice: "Kind, evidence-minded, practical. Gives coaches exact words to say." },
];
export const CHAIR = { id: "chair", name: "Clara \"The Clipboard\" Chen", emoji: "📋",
  role: "Committee chair: turns the advice into one clear plan the coach can run." };
export const MEMBER_IDS = COMMITTEE.map((m) => m.id);

function teamLine(ctx) {
  const c = ctx || {};
  return [c.team && `Team: ${c.team}`, c.sub && `Group: ${c.sub}`, c.format && `Format: ${c.format}`, c.formation && `Formation: ${c.formation}`,
    c.players && `Roster size: ${c.players}`, c.positions && `Positions: ${c.positions}`].filter(Boolean).join(". ");
}

export function askSystem(ctx) {
  return `You run "Coach the Coach", an AI coaching committee inside a youth soccer team app.
The committee members are fictional characters. Each is inspired by a school of coaching, not by any real person.
Never say or suggest a member is a real coach, never name real coaches as the speaker, and never invent quotes from real people.

Committee:
${COMMITTEE.map((m) => `- ${m.id}: ${m.name} (${m.emoji}). Inspired by ${m.school}. Strengths: ${m.strengths}. Voice: ${m.voice}`).join("\n")}
- chair: ${CHAIR.name}. ${CHAIR.role}

How to answer:
- Pick the three members whose strengths fit the question best (or the members the coach asks for). Each answers in their own voice, in 60 to 130 words, with practical, specific advice for this team.
- The chair then writes a short summary (2 to 4 sentences) and, when a practice would help, a session plan of 2 to 5 activities with minutes, a one-line setup and two or three coaching points each. Leave the session empty when no practice is needed.
- Fit the advice to the age group and format. Youth soccer: keep it fun, safe, and fair; no punishment running, no shaming, and players' wellbeing comes first.
- If a question is about an injury, concussion, or a child's safety or welfare, the members say to follow medical advice and the club's safeguarding policy, and keep coaching advice general.

${teamLine(ctx)}`.trim();
}

export function playSystem(ctx) {
  return `You draw plays and drills for a coaching board in a youth soccer team app.
The board is a soccer field seen from above. Coordinates are percentages: x from 0 (left touchline) to 100 (right touchline), y from 0 (the goal we attack, top) to 100 (our own goal, bottom).
Use field "full" for whole-field shape, "half" for the attacking or defending half (y still runs 0 to 100 across the shown half), "third" for small areas and drills.
Objects: our players (kind "us", label with a position like "LB" or a short name), opponents (kind "them"), the ball (kind "ball", exactly one), cones (kind "cone").
Steps: 2 to 6 steps. Every step lists the position of every object. Arrows show what happens next: "run" (player moves without the ball), "pass", "dribble", "shot".
Keep it simple enough for youth players: few objects (usually 4 to 12), clear movement, a one-sentence caption per step.
${teamLine(ctx)}`.trim();
}

const S = (o) => ({ type: "object", additionalProperties: false, required: Object.keys(o), properties: o });
export const ASK_SCHEMA = S({
  members: { type: "array", items: S({ id: { type: "string", enum: MEMBER_IDS }, answer: { type: "string" } }) },
  chair: S({
    summary: { type: "string" },
    session: { type: "array", items: S({ name: { type: "string" }, minutes: { type: "integer" }, setup: { type: "string" }, points: { type: "array", items: { type: "string" } } }) },
  }),
});
const PT = S({ x: { type: "number" }, y: { type: "number" } });
export const PLAY_SCHEMA = S({
  title: { type: "string" },
  field: { type: "string", enum: ["full", "half", "third"] },
  notes: { type: "string" },
  objects: { type: "array", items: S({ id: { type: "string" }, kind: { type: "string", enum: ["us", "them", "ball", "cone"] }, label: { type: "string" } }) },
  steps: { type: "array", items: S({
    caption: { type: "string" },
    pos: { type: "array", items: S({ id: { type: "string" }, x: { type: "number" }, y: { type: "number" } }) },
    arrows: { type: "array", items: S({ kind: { type: "string", enum: ["run", "pass", "dribble", "shot"] }, from: PT, to: PT }) },
  }) },
});

// Keep what the model returns inside the board and the committee.
const clamp = (v) => Math.max(0, Math.min(100, Math.round((Number(v) || 0) * 10) / 10));
export function cleanPlay(p) {
  const objects = (p.objects || []).slice(0, 30).map((o, i) => ({ id: String(o.id || "o" + i).slice(0, 12), kind: ["us", "them", "ball", "cone"].includes(o.kind) ? o.kind : "us", label: String(o.label || "").slice(0, 10) }));
  const ids = new Set(objects.map((o) => o.id));
  const steps = (p.steps || []).slice(0, 8).map((s) => ({
    caption: String(s.caption || "").slice(0, 200),
    pos: (s.pos || []).filter((q) => ids.has(String(q.id))).map((q) => ({ id: String(q.id), x: clamp(q.x), y: clamp(q.y) })),
    arrows: (s.arrows || []).slice(0, 20).map((a) => ({ kind: ["run", "pass", "dribble", "shot"].includes(a.kind) ? a.kind : "run", from: { x: clamp(a.from && a.from.x), y: clamp(a.from && a.from.y) }, to: { x: clamp(a.to && a.to.x), y: clamp(a.to && a.to.y) } })),
  })).filter((s) => s.pos.length);
  return { title: String(p.title || "Play").slice(0, 80), field: ["full", "half", "third"].includes(p.field) ? p.field : "full", notes: String(p.notes || "").slice(0, 400), objects, steps };
}
export function cleanAsk(a) {
  return {
    members: (a.members || []).filter((m) => MEMBER_IDS.includes(m.id)).slice(0, 4).map((m) => ({ id: m.id, answer: String(m.answer || "").slice(0, 2000) })),
    chair: { summary: String((a.chair && a.chair.summary) || "").slice(0, 1500),
      session: ((a.chair && a.chair.session) || []).slice(0, 6).map((s) => ({ name: String(s.name || "").slice(0, 80), minutes: Math.max(0, Math.min(120, Math.round(Number(s.minutes) || 0))), setup: String(s.setup || "").slice(0, 400), points: (s.points || []).slice(0, 4).map((x) => String(x).slice(0, 200)) })) },
  };
}
