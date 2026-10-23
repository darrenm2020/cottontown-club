import Anthropic from "@anthropic-ai/sdk";

// One place that calls Claude for the app's AI features.
// Model: COACH_MODEL (default claude-opus-5-5). Key: ANTHROPIC_API_KEY, or Netlify's AI Gateway supplies one.
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "").trim();
export const aiModel = () => env("COACH_MODEL") || "claude-opus-5-5";
export const newClient = () => new Anthropic({ timeout: 50000, maxRetries: 0 });

// Returns { data } (parsed JSON from structured output) or { error, status } with a message people can read.
export async function askJSON(client, { system, messages, schema, effort = "low", maxTokens = 8000 }) {
  const base = { model: aiModel(), max_tokens: maxTokens, thinking: { type: "adaptive" },
    output_config: { effort, format: { type: "json_schema", schema } }, system, messages };
  let msg;
  try {
    try {
      // Server-side fallback: if a request is declined, Anthropic re-runs it on its recommended model.
      msg = await client.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      // Netlify's AI Gateway can't pass beta headers through; ask again without the fallback.
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      msg = await client.messages.create(base);
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "The AI isn't set up yet (no API key in Netlify).", status: 503 };
    if (e instanceof Anthropic.RateLimitError) return { error: "The AI is busy. Try again in a minute.", status: 429 };
    if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError) return { error: "The AI model isn't available. Check COACH_MODEL in Netlify.", status: 502 };
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { error: "The AI took too long. Try a shorter question.", status: 504 };
    if (e instanceof Anthropic.APIError) return { error: "The AI had a problem. Try again.", status: 502 };
    throw e;
  }
  if (msg.stop_reason === "refusal") return { error: "The AI can't help with that one. Try asking it another way.", status: 422 };
  if (msg.stop_reason === "max_tokens") return { error: "That answer ran too long. Try a narrower question.", status: 502 };
  const text = msg.content.filter((x) => x.type === "text").map((x) => x.text).join("");
  try { return { data: JSON.parse(text), text }; } catch { return { error: "The AI's answer came back garbled. Try again.", status: 502 }; }
}
