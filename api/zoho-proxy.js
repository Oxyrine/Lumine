// Zoho Books' API does not send CORS headers permitting direct browser calls (confirmed
// live: "blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present" when
// zoho.js first tried to call it directly). CORS is enforced by the browser, not the
// server, so a Node function has no such restriction — this proxies authenticated GET
// requests through to https://www.zohoapis.in/books/v3<path>. The access token passes
// through in the Authorization header exactly as the client already holds it; nothing
// server-only (no client secret) is used here — that's api/zoho-callback.js's job.
//
// CommonJS for the same reason as zoho-callback.js — no package.json in this repo.

const API_BASE = "https://www.zohoapis.in/books/v3"; // keep in sync with zoho.js's DC

module.exports = async (req, res) => {
  const auth = req.headers.authorization;
  const path = req.query.path;

  if (!auth) return res.status(401).json({ message: "missing Authorization header" });
  if (!path || typeof path !== "string" || !path.startsWith("/")) {
    return res.status(400).json({ message: "missing or invalid ?path=" });
  }

  try {
    const upstream = await fetch(`${API_BASE}${path}`, { headers: { Authorization: auth } });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ message: e.message || "upstream request failed" });
  }
};
