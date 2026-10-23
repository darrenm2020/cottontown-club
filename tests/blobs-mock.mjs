// In-memory stand-in for @netlify/blobs so the functions can be tested locally.
const stores = new Map();
export function getStore(opts) {
  const name = typeof opts === "string" ? opts : opts.name;
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  return {
    async get(k, o) { if (!m.has(k)) return null; const v = m.get(k); return o && o.type === "json" ? JSON.parse(v) : v; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async set(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })) }; },
  };
}
export function _reset() { stores.clear(); }
