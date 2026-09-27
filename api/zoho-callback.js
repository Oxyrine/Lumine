// The only place ZOHO_CLIENT_SECRET is ever read — a Vercel serverless function, not
// static site code. Exchanges the OAuth authorization code for a short-lived access
// token and redirects back with it in the URL fragment (never sent to any server on a
// later request, never rendered in a response body). No refresh-token persistence —
// see zoho.js's header comment for why; this function is deliberately stateless.
//
// CommonJS on purpose: the rest of this repo has no package.json/build step (spec §17),
// and Vercel's default Node runtime treats a bare .js file as CommonJS without one —
// adding a package.json just for "type": "module" would be a bigger footprint than one
// CommonJS file.

const ACCOUNTS_BASE = "https://accounts.zoho.in"; // keep in sync with zoho.js's DC

module.exports = async (req, res) => {
  const { code, error } = req.query;
  const site = `https://${req.headers.host}`;
  const redirect = (fragment) => { res.writeHead(302, { Location: `${site}/#${fragment}` }); res.end(); };

  if (error) return redirect(`zoho_error=${encodeURIComponent(error)}`);
  if (!code) return redirect(`zoho_error=${encodeURIComponent("missing authorization code")}`);

  try {
    const params = new URLSearchParams({
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      redirect_uri: process.env.ZOHO_REDIRECT_URI || `${site}/api/zoho-callback`,
      code,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = await tokenRes.json();

    if (!data.access_token) {
      return redirect(`zoho_error=${encodeURIComponent(data.error || "token exchange failed")}`);
    }
    return redirect(`zoho_access_token=${encodeURIComponent(data.access_token)}&zoho_expires_in=${data.expires_in || ""}`);
  } catch (e) {
    return redirect(`zoho_error=${encodeURIComponent(e.message || "token exchange failed")}`);
  }
};
