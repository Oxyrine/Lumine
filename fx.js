// Live FX rates for the multi-currency headline (spec §8a/§20's roadmap
// item). A thin, optional layer over pipeline.js's fixed RATES table —
// netByCurrency() already accepts a rates override, so wiring this in never
// touches netting math itself, only which numbers feed the INR rollup.
//
// Settlement-date policy (deliberately simple, stated rather than half-built):
// spot/latest rates only. A real treasury system needs a trade-date vs.
// settlement-date FX convention; that's a genuine limitation, not built here.
//
// Fetches only on explicit user action (a "Refresh live rates" button), never
// at boot — consistent with the app's "nothing happens over the network
// unless triggered" posture. Goes through window.fetch, so the header's
// "Cut the network" toggle blocks this exactly like everything else.

const ENDPOINT = "https://open.er-api.com/v6/latest/INR";
const CACHE_KEY = "lumine_fx_cache_v1";
const TRACKED = ["USD", "EUR", "AED"]; // the non-INR currencies fixture.js actually uses

// The API returns "1 INR = X <currency>"; pipeline.js's RATES convention is
// the inverse, "1 <currency> = X INR" — invert each tracked rate to match.
// Pure and dependency-free so it's unit-testable without a network call.
export function invertRates(apiRates) {
  const rates = { INR: 1 };
  for (const ccy of TRACKED) {
    const perInr = apiRates?.[ccy];
    if (typeof perInr === "number" && perInr > 0) rates[ccy] = 1 / perInr;
  }
  return rates;
}

export async function fetchLiveRates() {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`FX provider returned HTTP ${res.status}`);
  const data = await res.json();
  if (data.result !== "success" || !data.rates) throw new Error("FX provider returned an unexpected response");

  const result = {
    rates: invertRates(data.rates),
    fetchedAt: data.time_last_update_utc || new Date().toUTCString(),
    source: "exchangerate-api.com (open endpoint)",
  };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch { /* private mode etc. — cache is a convenience, not load-bearing */ }
  return result;
}

export function getCachedRates() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
