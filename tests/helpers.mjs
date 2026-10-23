process.env.COACH_CODE = "master-code";
export const call = async (handler, method, path, body) => {
  const req = new Request("https://test.local" + path, method === "POST"
    ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method });
  const r = await handler(req);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
};
