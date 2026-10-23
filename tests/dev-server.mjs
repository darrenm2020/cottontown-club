// Local test server: serves the app and runs the Netlify functions against the in-memory blob store.
// node --import ./tests/register.mjs tests/dev-server.mjs [port]   (FAKE_AI=1 answers AI calls with canned data)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.COACH_CODE ||= "master-code";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fn = async (f) => (await import(path.join(root, "netlify/functions", f))).default;
const coachMod = await import(path.join(root, "netlify/functions/coach.mjs"));
const routes = { "/api/state": await fn("state.mjs"), "/api/cal": await fn("cal.mjs") };
const fakeAI = {
  beta: { messages: { create: async (p) => fakeReply(p) } }, messages: { create: async (p) => fakeReply(p) },
};
function fakeReply(p) {
  const play = p.output_config.format.schema.properties.steps;
  const obj = play ? { title: "Overlap on the left", field: "half", notes: "Fake play", objects: [{ id: "lb", kind: "us", label: "LB" }, { id: "lm", kind: "us", label: "LM" }, { id: "d", kind: "them", label: "" }, { id: "ball", kind: "ball", label: "" }],
      steps: [{ caption: "LM has the ball, LB starts the overlap", pos: [{ id: "lb", x: 15, y: 80 }, { id: "lm", x: 20, y: 55 }, { id: "d", x: 25, y: 45 }, { id: "ball", x: 22, y: 56 }], arrows: [{ kind: "run", from: { x: 15, y: 80 }, to: { x: 10, y: 35 } }] },
        { caption: "LM passes into the LB's run", pos: [{ id: "lb", x: 10, y: 35 }, { id: "lm", x: 22, y: 50 }, { id: "d", x: 24, y: 48 }, { id: "ball", x: 11, y: 34 }], arrows: [{ kind: "pass", from: { x: 22, y: 52 }, to: { x: 11, y: 34 } }] }] }
    : { members: [{ id: "grassroots", answer: "Play lots of 4v4 with two goals each side." }, { id: "space", answer: "Give everyone a lane: wide players touch the chalk." }, { id: "mindset", answer: "Praise the spacing, not just goals." }],
      chair: { summary: "Small-sided games that reward width.", session: [{ name: "4v4 four goals", minutes: 20, setup: "30x25 grid, 2 goals per end", points: ["Wide = open", "Scan before receiving"] }, { name: "7v7 scrimmage", minutes: 25, setup: "Full field", points: ["Freeze and fix spacing once"] }] } };
  return { stop_reason: "end_turn", model: p.model, content: [{ type: "text", text: JSON.stringify(obj) }] };
}
routes["/api/coach"] = (req) => coachMod.handle(req, process.env.FAKE_AI ? { client: fakeAI } : {});
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const h = routes[u.pathname];
  if (h) {
    const body = req.method === "POST" ? await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); }) : undefined;
    const r = await h(new Request(u, { method: req.method, headers: { "Content-Type": "application/json" }, body }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const f = path.join(root, u.pathname === "/" ? "index.html" : u.pathname);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(+process.argv[2] || 8888, () => console.log("dev server on", +process.argv[2] || 8888));
