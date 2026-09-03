# Lumine — pre-shortlist prototype

On-device counterparty resolution with a governance gate before deterministic netting.
iQOO Hackathon 2026, Chennai City Battle. This is the **rudimentary web prototype** (spec §16),
not the finished product.

## What it does

A single-page, phone-width web app that runs the real matching pipeline **locally in the browser**:

1. **Normalize** — alias dictionary + character-bigram fuzzy score.
2. **Semantic match** — MiniLM sentence embeddings via `transformers.js`, run in-browser (WASM).
   No cloud matching API is called. After the first load the model sits in the browser cache and
   matching works offline.
3. **Authoritative ID check** — exact GSTIN comparison; `match` / `conflict` / `absent`.
4. **Governance gate** — deterministic:
   - exact ID match → `AUTO_MERGE` (semantic score recorded, not used)
   - ID conflict → `KEEP_SEPARATE` (overrides semantic confidence)
   - no ID, high semantic, ≥1 corroborating flag → `REVIEW_REQUIRED` → analyst approves
   - no ID, high semantic, **zero** corroboration → `KEEP_SEPARATE` (deliberate: default to
     separation unless identity is corroborated — spec §5 leaves this branch implicit)
   - otherwise → `KEEP_SEPARATE`
5. **Deterministic netting** — validated identities only; unresolved counterparties are excluded
   (abstention = exclusion). Shows gross vs. draft settlement volume, reduction %, payment legs.

### Screens

- **Review** — the three scripted cases, one per outcome. Tap to see the AI-confidence vs.
  rule-decision split, evidence, the plain-language "Why", the netting delta, and approve /
  keep-separate. Approving freezes a mapping version and writes an audit line.
- **Live** — enter any two names (+ optional context, IDs, evidence flags); watch the six pipeline
  stages run: `INPUT → NORMALIZATION → LOCAL EMBEDDING → TOP CANDIDATES → EVIDENCE → GOVERNANCE DECISION`.
- **Netting** — the draft run; recomputes as approvals change.
- **Audit** — decision log in the spec §10 format.

## Run it

```bash
python -m http.server 8000   # or any static server; ES modules need http://, not file://
```

Open `http://localhost:8000`. First load downloads ~25 MB of model weights.

```bash
node test.mjs                 # gate logic + netting math, no model needed
```

## Honest scope

- Runs locally **in-browser** today (WASM). On the iQOO 15 the same architecture is designed to
  execute via the Snapdragon NPU delegate — verified at the venue as the first task, not claimed here.
- The model is pretrained and used for inference only. No training or fine-tuning on settlement data.
- **Deliberately not built** (visible on-site work): voice approval, NPU delegate execution,
  multi-currency netting, real vendor-master integration, the full 48-case metrics fixture and
  ablation, second-approver tiering.
- Data is synthetic (`fixture.js`). Six entities, one currency (INR), ten obligations, three cases.

## Files

| File | |
|---|---|
| `pipeline.js` | Pure logic: normalize, fuzzy, ID check, gate, whyText, netting. No DOM, no model. |
| `embed.js` | `transformers.js` wrapper — `Xenova/all-MiniLM-L6-v2`, q8, in-browser. |
| `fixture.js` | Three scripted cases + INR ledger. |
| `app.js` | UI wiring and state. |
| `test.mjs` | `node test.mjs` — asserts gate outcomes and netting math. |
| `sw.js` | Cache-first service worker so reload-in-airplane-mode works. |
