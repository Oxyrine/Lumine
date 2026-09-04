# Lumine — pre-shortlist prototype

On-device counterparty resolution with a governance gate before deterministic netting.
iQOO Hackathon 2026, Chennai City Battle. This is the **rudimentary web prototype** (spec §16)
that the shortlisting round judges — not the finished product.

**Live:** https://oxyrine.github.io/Lumine/

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
   - no ID, high semantic, **zero** corroboration → `KEEP_SEPARATE` (deliberate: default to
     separation unless identity is corroborated — spec §5 leaves this branch implicit)
   - otherwise → `KEEP_SEPARATE`
5. **Deterministic netting** — validated identities only; an obligation whose counterparty
   is unresolved is excluded (abstention = exclusion). Gross vs. draft settlement volume,
   reduction %, payment legs.

## Screens

- **Review** — the three scripted cases, one per outcome. Tap for the AI-confidence vs.
  rule-decision split, evidence, the plain-language "Why", the netting delta, and approve /
  keep-separate. The guided walkthrough narrates all three in order.
- **Live** — enter any two names (+ optional context, IDs, evidence flags); watch the six
  pipeline stages run.
- **Netting** — the draft run as a live entity graph; recomputes and re-wires as approvals
  change. On a wide screen it sits beside the review queue so cause and effect are visible
  together.
- **Proof** — the ablation (spec §12): 14 labelled pairs through fuzzy-only vs.
  fuzzy+embedding, same gate. Plotted as a scatter, then tabulated. The safety metric is
  false merges.
- **Audit** — the decision log in the spec §10 format, and the deliberately-not-built list.

The page opens with a cold-open overlay that presents the model download as an event, and
degrades to a working app (two of three cases still resolve) if the model never loads.

## Run it

```bash
python serve.py 8123      # no-cache static server; or `python -m http.server`
node test.mjs             # gate logic + netting math, no model needed — 22 assertions
```

ES modules need `http://`, not `file://`. First load downloads ~23 MB of model weights.

## Honest scope

- Runs in-browser on WASM today. On the iQOO 15 the same architecture is designed to
  execute via the Snapdragon NPU delegate — verified at the venue as the first task, not
  claimed here.
- The model is pretrained, inference only. No training on settlement data.
- **Deliberately not built** (on-site work, not hidden): voice approval, second-approver
  tiering, NPU delegate execution, multi-currency netting, real vendor-master / ERP
  integration, the full 48-case metrics fixture behind the Proof tab's 14.
- Data is synthetic (`fixture.js`): six entities, one currency (INR), ten obligations,
  three cases.

## Files

| File | |
|---|---|
| `pipeline.js` | Pure logic: normalize, fuzzy, ID check, gate, whyText, netting, ablation. No DOM, no model. |
| `embed.js` | `transformers.js` wrapper — MiniLM q8, in-browser. Resets on a failed load so a retry is possible. |
| `fixture.js` | Three scripted cases, the INR ledger, and the 14 labelled ablation pairs. |
| `graph.js` | Pure-SVG netting graph — one instance, moved between layouts, animates between states. |
| `scatter.js` | Pure-SVG ablation plot. |
| `app.js` | UI wiring and state. |
| `styles.css` | The design system. Fonts self-hosted under `fonts/` (SIL OFL) so offline holds. |
| `sw.js` | Network-first service worker over the app shell — fresh files in dev, cache fallback offline. |
| `test.mjs` | `node test.mjs` — asserts gate outcomes, netting math, and ablation routing. |
