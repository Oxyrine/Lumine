// Zoho Books OAuth2 + API client. The client secret never reaches this file or the
// browser — it lives only in api/zoho-callback.js, read from process.env on the server.
// This module only ever holds the short-lived access token the callback hands back.
//
// Deliberate scope cut (spec §19/§20): no refresh-token persistence. Lumine has no
// database, so there's nowhere secure server-side to hold a long-lived refresh token
// between requests. The access token (~1hr) lives in sessionStorage; when it expires the
// user reconnects. This keeps api/zoho-callback.js genuinely stateless.
//
// This feature only works on the deployed Vercel site (or `vercel dev` locally) —
// python serve.py is a static file server and cannot run api/zoho-callback.js or
// api/zoho-proxy.js.
//
// All Books API calls go through api/zoho-proxy.js, not directly to Zoho — confirmed
// live that Zoho's API sends no Access-Control-Allow-Origin header, so the browser
// blocks a direct cross-origin fetch outright regardless of token validity. A Node
// function has no such restriction (CORS is a browser policy, not a server one), so it
// proxies the same authenticated GET through server-side.

import { mapZohoToLedger } from "./zoho-mapping.js";

const DC = "in"; // Zoho data center — .in given Lumine's GSTIN-first framing; adjust if the connected account is on a different DC
const ACCOUNTS_BASE = `https://accounts.zoho.${DC}`;
const PROXY_BASE = "/api/zoho-proxy";
const TOKEN_KEY = "lumine_zoho_token";
const SCOPES = "ZohoBooks.contacts.READ,ZohoBooks.settings.READ,ZohoBooks.fullaccess.READ";

// Set via index.html before app.js loads, or hardcode after registering the app
// (see the provisioning wizard) — the client ID is public, safe to ship to the browser.
export function getClientId() {
  return window.LUMINE_ZOHO_CLIENT_ID || "";
}

export function startZohoAuth() {
  const clientId = getClientId();
  if (!clientId) throw new Error("Zoho client ID not configured — see the provisioning steps in README.md");
  const redirectUri = `${location.origin}/api/zoho-callback`;
  const params = new URLSearchParams({
    scope: SCOPES,
    client_id: clientId,
    response_type: "code",
    access_type: "offline",
    redirect_uri: redirectUri,
    prompt: "consent",
  });
  location.href = `${ACCOUNTS_BASE}/oauth/v2/auth?${params}`;
}

// Reads the access token (or error) out of the URL fragment left by
// api/zoho-callback.js's redirect, stores it, and strips the fragment so a page
// reload/share never carries it. Call once at boot.
export function consumeAuthFragment() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!hash) return { token: getStoredToken(), error: null };

  const params = new URLSearchParams(hash);
  const token = params.get("zoho_access_token");
  const error = params.get("zoho_error");

  if (token || error) {
    history.replaceState({}, document.title, location.pathname + location.search);
  }
  if (token) {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* private mode etc. */ }
    return { token, error: null };
  }
  return { token: getStoredToken(), error };
}

export function getStoredToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function disconnectZoho() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function zohoFetch(token, path) {
  const res = await fetch(`${PROXY_BASE}?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Zoho API returned HTTP ${res.status}`);
  }
  return res.json();
}

// Follows Zoho's page/has_more_page pagination, collecting `field` from every page.
async function zohoFetchAll(token, basePath, field, extraParams = "") {
  const items = [];
  let page = 1;
  for (;;) {
    const data = await zohoFetch(token, `${basePath}${extraParams}&page=${page}&per_page=200`);
    items.push(...(data[field] || []));
    if (!data.page_context?.has_more_page) break;
    page += 1;
  }
  return items;
}

export async function fetchOrganizations(token) {
  const data = await zohoFetch(token, "/organizations");
  return data.organizations || [];
}

export async function fetchVendorLedger(token, organizationId, organizationName) {
  const orgParam = `?organization_id=${organizationId}`;
  const [vendors, bills] = await Promise.all([
    zohoFetchAll(token, "/contacts", "contacts", `${orgParam}&contact_type=vendor`),
    zohoFetchAll(token, "/bills", "bills", orgParam),
  ]);

  return mapZohoToLedger({ organizationId, organizationName, vendors, bills });
}
