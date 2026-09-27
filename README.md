# Lumine

On-device counterparty resolution with a governance gate before deterministic netting.

**Live:** https://lumine-opal.vercel.app · **Mirror:** https://oxyrine.github.io/Lumine/

## What it does

A single-page web app that runs the real matching pipeline **locally in the browser** — no
cloud matching API. A treasury analyst reviews ambiguous counterparty-name matches; an
on-device embedding model proposes a similarity score; a deterministic governance gate
decides; the human authorizes; and only then does the identity enter a deterministic
netting run.

1. **Normalize** — alias dictionary + character-bigram fuzzy score.
2. **Semantic match** — `Xenova/all-MiniLM-L6-v2` (q8, ~23 MB) via `transformers.js`, run
   in-browser on WASM. After the first load the weights sit in the Cache API and matching
   works with the network off.
3. **Authoritative ID check** — exact GSTIN comparison; `match` / `conflict` / `absent`.
   When the ID is decisive the model is not consulted at all.
4. **Governance gate** — deterministic:
   - exact ID match → `AUTO_MERGE` (semantic score recorded, not used)
   - ID conflict → `KEEP_SEPARATE` (overrides semantic confidence)
   - no ID, high semantic, ≥1 corroborating flag → `REVIEW_REQUIRED` → analyst approves
     (a second analyst too, if the counterparty's exposure is above the dual-control
     threshold)
   - no ID, high semantic, **zero** corroboration → `KEEP_SEPARATE` (deliberate: default to
     separation unless identity is corroborated — spec §7 leaves this branch easy to miss
     on a first read, so it's called out explicitly)
   - otherwise → `KEEP_SEPARATE`
5. **Deterministic netting** — validated identities only; an obligation whose counterparty
   is unresolved is excluded (abstention = exclusion). Grouped by currency — an INR and a
   USD obligation are never netted against each other. Gross vs. draft settlement volume,
   reduction %, payment legs.

## Screens

- **Review** — the three scripted cases, one per outcome. Tap for the AI-confidence vs.
  rule-decision split, evidence, the plain-language "Why", the netting delta, and approve /
  keep-separate. The guided walkthrough narrates all three in order.
- **Live** — enter any two names (+ optional context, IDs, evidence flags); watch the six
  pipeline stages run.
- **Netting** — the draft run as a live entity graph; recomputes and re-wires as approvals
  or reversals change it. On a wide screen it sits beside the review queue so cause and
  effect are visible together. A per-currency breakdown sits below the INR draft, with a
  "Refresh live rates" button — otherwise a fixed reference table.
- **Import** — upload a CSV or JSON settlement ledger; every row is validated on-device
  (bad rows are named, never silently dropped), and applying it swaps the Netting screen to
  the imported ledger until reset. Also has a "Connect Zoho Books" option — pulls vendors
  and unpaid bills through the same validation path (deployed site only; see setup below).
- **Voice authorize** — on the Review detail, speak "approve" or "keep separate"; the
  utterance is transcribed on-device (`Xenova/whisper-tiny.en`, not the browser's built-in
  `SpeechRecognition` — that's server-backed) and shown back for confirmation before it
  applies.
- **Proof** — the ablation (spec §9): 48 labelled pairs through fuzzy-only vs.
  fuzzy+embedding, same gate. Plotted as a scatter, then tabulated. The safety metric is
  false merges.
- **Audit** — the decision log in the spec §14 format, including reversals, dual-control
  steps, and ledger import/reset, and the current-limitations list.

The page opens with a cold-open overlay that presents the model download as an event, and
degrades to a working app (two of three cases still resolve) if the model never loads.

## Run it

```bash
python serve.py 8123      # no-cache static server; or `python -m http.server`
node test.mjs             # gate logic, netting math, ablation routing, ledger + voice-grammar + FX + Zoho-mapping validation — no model needed, 39 assertions
```

ES modules need `http://`, not `file://`. First load downloads ~23 MB of model weights (plus
~40 MB more, lazily, the first time voice authorization is used).

## Setting up the Zoho Books connector (optional)

Only needed if you want "Connect Zoho Books" to actually work — everything else in the app
runs with zero setup. This is the one non-static part of Lumine; `python serve.py` can't run
it, only the deployed Vercel site (or `vercel dev` locally).

Run `scripts/setup-zoho.sh` for a guided walkthrough of all five steps below (it opens the
right pages, tells you exactly what to paste where, and patches `index.html`'s client id
line for you — it never asks for or stores the client secret, that only ever goes into
Vercel's own dashboard). Or do it by hand:

1. Register a **Server-based Application** at https://api-console.zoho.com/. Redirect URI:
   `https://<your-deployment>/api/zoho-callback`.
2. In `index.html`, set `window.LUMINE_ZOHO_CLIENT_ID` to the client ID (public, safe to
   commit — it's not the secret).
3. In your Vercel project settings, add environment variables `ZOHO_CLIENT_ID` (same value
   as above), `ZOHO_CLIENT_SECRET`, and `ZOHO_REDIRECT_URI` (the same URL as step 1).
4. `zoho.js`'s `DC` constant defaults to `"in"` (Zoho's India data center) — change it (and
   the matching constant in `api/zoho-proxy.js`) if your account is on a different one.
5. You'll need a Zoho Books organization with at least one vendor and bill to see anything
   after connecting.

## Honest scope

- Runs in-browser on WASM today. A Snapdragon NPU delegate for the same architecture is a
  known follow-up, not built here — it needs the physical hardware to verify against.
- The model is pretrained, inference only. No training on settlement data.
- **Current limitations** (spec §19): NPU delegate execution; the Zoho Books connector is
  built and unit-tested but never exercised against a real account end-to-end (registering
  the OAuth app and signing in are both things only a human can do); and voice authorization
  has never been exercised against real speech end-to-end (needs a real microphone to
  confirm).
- Data is synthetic (`fixture.js`): six entities, sixteen obligations across four
  currencies, three review cases, 48 labelled ablation pairs.

## Files

| File | |
|---|---|
| `pipeline.js` | Pure logic: normalize, fuzzy, ID check, gate, whyText, netting (incl. multi-currency and dual-control exposure), ablation. No DOM, no model. |
| `embed.js` | `transformers.js` wrapper — MiniLM q8, in-browser. Resets on a failed load so a retry is possible; caches embeddings by input string. |
| `fixture.js` | Three scripted cases, the multi-currency ledger, and the 48 labelled ablation pairs. |
| `graph.js` | Pure-SVG netting graph — one instance, moved between layouts, animates between states; its topology can be swapped for an imported ledger. |
| `scatter.js` | Pure-SVG ablation plot. |
| `import.js` | Hand-rolled CSV/JSON ledger parser and validator — the first untrusted data source in the app. |
| `voice.js` | `Xenova/whisper-tiny.en` via `transformers.js` — mic capture, on-device transcription, loaded lazily on first use. |
| `voice-grammar.js` | Pure approve/keep-separate/cancel phrase matching — no model dependency, so it's unit-testable without pulling in the CDN import. |
| `fx.js` | Live FX rate fetch (on request only) + localStorage cache for the multi-currency headline; `invertRates()` is pure and unit-tested. |
| `zoho.js` | Zoho Books OAuth redirect + API client, via `api/zoho-proxy.js` (direct browser calls are CORS-blocked by Zoho's API). |
| `zoho-mapping.js` | Pure vendor/bill → `import.js`-shaped ledger mapping, unit-tested without a network call. |
| `api/zoho-callback.js` | Vercel serverless function — the only place the Zoho client secret is read; OAuth token exchange. |
| `api/zoho-proxy.js` | Vercel serverless function — proxies authenticated Books API reads past Zoho's CORS restriction. |
| `app.js` | UI wiring and state. |
| `styles.css` | The design system. Fonts self-hosted under `fonts/` (SIL OFL) so offline holds. |
| `sw.js` | Network-first service worker over the app shell — fresh files in dev, cache fallback offline. |
| `test.mjs` | `node test.mjs` — asserts gate outcomes, netting math, ablation routing, ledger import validation, the voice-authorization grammar, FX rate inversion, and the Zoho vendor/bill mapping. |
