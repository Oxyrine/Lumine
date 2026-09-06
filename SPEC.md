# Lumine — Specification

*Updated to reflect the pre-shortlist prototype as built. Supersedes the original master brief; section numbers below track the brief's where they correspond.*

Team Tiramisu · iQOO Hackathon 2026 · Chennai City Battle · 12–13 Sep 2026
Live: https://lumine-opal.vercel.app · Mirror: https://oxyrine.github.io/Lumine/ · Repo: github.com/Oxyrine/Lumine

---

## 0. What this document is

The original brief described a product. This describes what actually exists — the working prototype submitted for pre-shortlisting, the decisions taken building it, and what the 30-hour on-site build adds. Where the prototype deviates from the brief, the deviation is called out and justified (search **Deviation**).

---

## 1. Thesis

**AI proposes. Evidence corroborates. Humans authorize. Only then does the identity enter netting.**

Lumine resolves whether two counterparty names refer to the same legal entity — the step a corporate treasury must get right before netting intercompany and vendor obligations. Merging two entities that are not the same makes the netting engine offset obligations that should not offset, which misdirects a real payment.

The model never decides. It surfaces candidates. A deterministic gate and a human decide. The default is separation; an identity enters a netting run only when its identity is corroborated by something other than model confidence.

---

## 2. Scope

**This is the pre-shortlist artifact (brief §16), not the product.**

In scope:
- The full matching pipeline, running locally in the browser
- Three scripted review cases, one per governance outcome
- Free-form live input
- A deterministic netting run that recomputes as identities are authorized
- A held-out ablation proving the embedding layer's contribution
- An audit log
- A visible offline demonstration

Out of scope — see §19.

Data is synthetic (`fixture.js`): 6 legal entities, 1 currency (INR), 10 intercompany obligations, 3 review cases, 14 held-out ablation pairs.

---

## 3. The pipeline

Five layers. Layers 1, 3, 4, 5 are deterministic and run identically in Node and the browser (`pipeline.js` — no DOM, no model import). Layer 2 is the only ML step and runs only in the browser.

```
name + context
  │
  ▼  L1  Normalization ......... alias expansion, tokenization, character-bigram fuzzy score
  ▼  L2  On-device semantic .... MiniLM sentence embedding, cosine similarity   (browser only)
  ▼  L3  Authoritative ID ...... exact GSTIN comparison → match | conflict | absent
  ▼  L4  Governance gate ....... deterministic decision (brief §5)
  ▼  L5  Netting .............. deterministic, resolved identities only (brief §7)
```

The Live screen surfaces this as six stages: `INPUT → NORMALIZATION → LOCAL EMBEDDING → TOP CANDIDATES → EVIDENCE → GOVERNANCE DECISION`. "TOP CANDIDATES" is always exactly one pair in this prototype — narration must not imply a search over many.

---

## 4. Layer 1 — Normalization

`normalize(name)` — lowercase; strip punctuation; expand an alias dictionary (`pvt→private`, `ltd→limited`, `&→and`, `corp→corporation`, `intl→international`, `inc→incorporated`, …); drop structural stopwords (`private`, `limited`, `company`, `corporation`, `incorporated`, `india`, `the`) from the token set used for overlap scoring.

`fuzzyScore(a, b)` — Dice coefficient over character bigrams of the significant (non-stopword) tokens. Range 0–1, deterministic. This is the entirety of "string matching" in the system. It is intentionally weak: its job in the ablation is to be the honest baseline, not to be good.

---

## 5. Layer 2 — On-device semantic match

- Library: `@huggingface/transformers` (transformers.js) `v3.0.2`, pinned, from jsDelivr.
- Model: `Xenova/all-MiniLM-L6-v2`, `dtype: "q8"` (8-bit quantized, ~23 MB).
- Runtime: WebAssembly, in the browser. **No cloud matching API is called.**
- `env.allowLocalModels = false` — weights are fetched once from the HF CDN, then held in the browser Cache API. After the first load, matching works with the network off.
- Embedded text: `` `${name} — ${context}` `` for each side, mean-pooled, L2-normalized.
- Similarity: dot product of the unit vectors (cosine).
- `loadModel()` clears its cached promise on rejection, so a failed load (blocked CDN, dead venue wifi) can be retried instead of permanently bricking the page.

On the iQOO 15 the same architecture is designed to run via the Snapdragon NPU delegate — a 30-hour task, verified at the venue, not claimed here.

---

## 6. Layer 3 — Authoritative ID check

`idCheck(idA, idB)` over `{ type, value }` pairs (GSTIN in the fixture):
- both present, same type, values equal (case-insensitive, trimmed) → `match`
- both present, same type, values differ → `conflict`
- either absent, or types differ → `absent`

---

## 7. Layer 4 — The governance gate (brief §5)

`HIGH = 0.62` — the semantic-similarity threshold. Calibrated once against the model's real output on the three cases, then frozen (see §21).

Corroborating flags (`corroboratingFlags(evidence)`): `same corporate domain`, `post-merger metadata`, `recurring settlement description`. At least one must be present for the semantic path to reach a human.

| Condition | Decision | Authority |
|---|---|---|
| ID `match` | `AUTO_MERGE` | rule — semantic score recorded for audit, plays no role |
| ID `conflict` | `KEEP_SEPARATE` | rule — **overrides semantic confidence entirely** |
| ID `absent`, semantic ≥ HIGH, ≥1 corroborating flag | `REVIEW_REQUIRED` | rule → routed to a human |
| ID `absent`, semantic ≥ HIGH, **zero** corroborating flags | `KEEP_SEPARATE` | rule — **deliberate** |
| ID `absent`, semantic < HIGH | `KEEP_SEPARATE` | rule |

**Deviation from the brief:** §5 left the fourth row implicit. It is now explicit and tested. High model confidence with no corroborating context is **not** sufficient to involve a human — the system defaults to separation unless identity is corroborated by something independent of the model. The on-screen "Why" line says this in plain language: *"Keep separate: semantic similarity is high but no corroborating context or identifier is available. Lumine defaults to separation unless identity is corroborated."* Feed this row, and Case 3's concrete pair (§15), back into brief §5 and §9.

---

## 8. Layer 5 — The netting engine (brief §7)

`net(obligations, mapping, resolvedEntities)`:

- **Abstention = exclusion.** An obligation whose `from` or `to` does not resolve (via an approved `mapping` entry) to a member of the entity set is dropped from the run.
- `gross` = Σ amount over included obligations.
- Per-entity `net position` = receivables − payables.
- `netSettlementVolume` = Σ |net position| / 2.
- `reductionPct` = (gross − netSettlementVolume) / gross × 100.
- Payment legs, central-clearing model: `legsBefore` = included obligation count; `legsAfter` = entities with a non-zero net position.

Fixture run, no approvals: gross ₹53,00,000 → net settlement volume ₹8,30,000 (84.3% reduction), 8 → 6 legs, 2 obligations excluded.
After approving Case 2 (Sunrise → Orbit): gross ₹61,40,000 → ₹7,80,000 (87.3%), 9 → 6 legs, 1 excluded.

---

## 9. The ablation — does the embedding layer earn its place? (brief §12)

`FUZZY_CANDIDATE = 0.5` — string-similarity at or above this makes a pair a merge candidate for the deterministic-only pipeline.

14 labelled pairs (`ABLATION_CASES`), each `truth ∈ {merge, review, separate}`. Two pipeline configurations, **same gate**:
- **fuzzy-only** — Layers 1 + 3. Candidate iff `fuzzy ≥ 0.5`.
- **fuzzy + embedding** — adds Layer 2. Candidate iff `fuzzy ≥ 0.5` OR `semantic ≥ HIGH`.

Metrics (`scoreAblation`):
- **false merges** — routed `AUTO_MERGE`, truth ≠ merge. The safety metric. Financially dangerous.
- **false separations** — routed `KEEP_SEPARATE`, truth ∈ {merge, review}. Efficiency cost.
- **review-routing recall** — of the `review` pairs, the fraction routed `REVIEW_REQUIRED`.

Computed live, on-device, in the Proof screen. Real result on the current fixture:

| | fuzzy-only | fuzzy + embedding |
|---|---|---|
| false merges | 0 | 0 |
| false separations | 4 | 0 |
| review-routing recall | 43% | 100% |

The four recovered pairs are brand-vs-legal-name and post-merger renames with near-zero string overlap (Sunrise↔Orbit, Meadowbrook↔Greenfield, Orion↔Pinnacle, Southgate↔Meridian Consumer). Neither configuration ever produces a false merge — the gate, not the matcher, is what makes that safe.

The Proof screen plots this: fuzzy (x) against semantic (y), y-axis clamped to 0.20–1.00 because MiniLM cosines never approach zero on real text. The shaded low-fuzzy / high-semantic quadrant, and the haloed points in it, are the recovered pairs — the visual statement of what the embedding sees that string matching cannot.

---

## 10. Screens

**Review** — the three scripted cases. The queue shows fuzzy / semantic / ID at a glance and the gate's badge. Cases the identifier decides (`match`, `conflict`) resolve without the model and say so ("the identifier decided this"). Tapping a case opens the split view: AI confidence (model) vs. gate decision (rule) as visibly separate quantities, the evidence ✓/✗ list, the plain "Why", the netting delta, and `[Keep separate] [Approve match]`. Approving freezes a mapping version and writes an audit line. A prominent "Start the walkthrough" card narrates all three cases in order for a first-time visitor.

**Live** — two names, optional context, optional ID per side, three evidence checkboxes. Runs the six stages with visible progress. Any pair; the result is whatever the model and gate actually produce.

**Netting** — the draft run as a live entity graph (`graph.js`, pure SVG): six entities on a ring, unresolved counterparties floating below with dashed excluded edges, net position on each node. Approving an identity re-wires the graph and rolls the settlement number. Recomputes on every decision.

**Proof** — the ablation, plotted then tabulated (§9). "Run evaluation" computes all 14 pairs on-device.

**Audit** — every decision in the brief §10 format, plus the "deliberately not built" list.

---

## 11. Responsive presentation — the stage

Below 900 px: the app is a 448 px column. The product.

At 900 px and above: `#app` becomes two columns — the phone in a device frame on the left, a companion panel on the right carrying the netting graph, the settlement number and the audit stream at projector size. The graph is a single instance moved between a slot inside the phone and a slot in the companion (`appendChild`, never re-created — `createGraph` has no teardown and its SVG `<marker>` id is document-global). Consequence is simultaneous on the wide layout: approve in the phone, the companion graph re-wires beside it with no navigation. On mobile the same moment plays when the Netting tab is opened (the graph is not rendered while its section is hidden, so the merge animation is saved for the reveal).

---

## 12. Cold open

A full-screen overlay over a laid-out app (never `display:none` — that would flash on dismiss; `<body>` scroll is locked while it is up). Carries the wordmark, the thesis, and the model load as an event.

- **Cached** — resolves fast; the overlay is a ~450 ms title card. Status: "model already on this device." No fabricated delay.
- **Slow** — a real progress bar on actual bytes; at 6 s, a "Skip — explore the interface" button. The model keeps loading.
- **Failed** — the real error, a working **Retry** (possible because `loadModel` resets on rejection; disabled while the network is cut), and "Continue without the model."

`scoreIdCases()` runs synchronously at load: the two cases the identifier decides are scored before the model exists and regardless of whether it ever loads. Degraded mode is a working app.

---

## 13. Offline behaviour (brief §15)

- Model weights: cached by transformers.js in the Cache API after first load. Matching then runs with the network off.
- `sw.js` — a network-first service worker over the app shell (HTML, JS, CSS, fonts). Fresh files in dev, cache fallback offline. A page reload in airplane mode still works.
- **"Cut the network"** (header) — monkeypatches `window.fetch` and `XMLHttpRequest` to reject. A genuine block, not a simulation: the dot goes red, the status line changes, and a Live pipeline run still resolves against the loaded model. This proves the *matching step* makes no network call — distinct from the page load, which is ordinary web traffic.

---

## 14. Audit log format (brief §10)

Approval:
```
Match #<id> approved by Analyst A at HH:MM:SS IST
Evidence: semantic <0.xx>, <corroborating flags | "no corroborating context">, ID <status>
Result: mapping frozen (v<n>) for netting run #2026-09-13-A
```
Keep-separate:
```
Match #<id> kept separate by Analyst A at HH:MM:SS IST
Reason: <gate reason>
Result: obligation excluded from netting run #2026-09-13-A
```
Lines are rendered as text, never as markup.

---

## 15. The three scripted cases (brief §9)

| # | Source | Candidate | IDs | Model semantic | Gate |
|---|---|---|---|---|---|
| 1 | Meridian Logistics Ltd | Meridian Logistics Limited | same GSTIN | ~0.67 (recorded, unused) | `AUTO_MERGE` |
| 2 | Sunrise Digital Services *(memo: "part of the Orbit group post-acquisition", domain orbitcomm.in, recurring monthly)* | Orbit Communications India Pvt Ltd *(telecom, orbitcomm.in, acquired Sunrise 2024)* | none | ~0.74 (≥ HIGH) | `REVIEW_REQUIRED` |
| 3 | Orbit Communication India Private Limited *(regional ISP, Coimbatore, GSTIN 33…)* | Orbit Communications India Pvt Ltd *(national, GSTIN 27…)* | **conflicting GSTIN** | ~0.75 (high — and ignored) | `KEEP_SEPARATE` |

Case 3 is the demonstration that matters: the model is *confident*, the strings are near-identical, and the ID conflict overrides both. Obligation `o10` (`cp-orbit-cbe → north-star`, ₹7,00,000) is sized so that wrongly approving this match produces a visible, misdirected −₹1,90,000 change in the netting run.

**Deviation from the brief:** §9 described Case 3 abstractly. The concrete Orbit Coimbatore pair is sharper and should replace the abstract description.

---

## 16. Data model (`fixture.js`)

Entities (6): `meridian`, `orbit`, `north-star`, `veritas`, `cobalt`, `harbor`.
Unresolved counterparties (2): `cp-sunrise` (→ `orbit` on Case 2 approval), `cp-orbit-cbe` (stays unresolved — Case 3 kept separate).
Obligations (10): `o1`–`o8` between entities; `o9` `cp-sunrise → north-star` ₹8,40,000; `o10` `cp-orbit-cbe → north-star` ₹7,00,000.

---

## 17. Architecture

- **No build step.** Plain ES modules, `<script type="module">`. No `package.json`, no bundler, no framework.
- Files: `index.html`, `styles.css`, `app.js` (one file — module-scope init order is load-bearing), `pipeline.js` (pure logic, imported by browser and Node), `embed.js`, `fixture.js`, `graph.js`, `scatter.js`, `sw.js`, `test.mjs`, `serve.py` (no-cache dev server, port 8123), `fonts/` (self-hosted, SIL OFL), `vercel.json`, `.nojekyll`.
- Fonts self-hosted because `sw.js` only caches same-origin — a CDN font would bypass the worker and break offline. Schibsted Grotesk (display), IBM Plex Mono (all numerals — the full upstream release; the Google CDN subset drops ₹ U+20B9).
- Deploy: Vercel (`lumine-opal.vercel.app`) and GitHub Pages (`oxyrine.github.io/Lumine`). Both zero-config static; `vercel.json` only forces `no-cache` on `sw.js`.
- Tests: `node test.mjs` — 22 assertions over gate outcomes, netting math, ablation routing. Authoritative for logic; must stay green.

---

## 18. Design

Editorial-treasury system. White canvas, navy ink (`#0a2540`), one indigo voltage (`#4b3fd6` — CTA, active tab, links, focus), ochre (`#8a5a12` — the `REVIEW_REQUIRED` hold state), semantic green / red for net positions, a warm parchment framing band. Every financial figure in tabular IBM Plex Mono — the "trustworthy number" register shared across the Stripe / Coinbase / Binance systems. Fixed type steps, one hero per screen.

---

## 19. Deliberately not built (brief §16)

Stated on the Audit tab, not hidden:
- Voice authorization; the second-approver tier
- Snapdragon NPU delegate execution (WASM today)
- Multi-currency netting (single-currency INR)
- Real vendor-master / ERP integration (synthetic ledger)
- The full 48-case metrics fixture behind the Proof tab's 14
- Reversal of an approved mapping

For pre-shortlisting this list is a statement of judgment, not a gap.

---

## 20. The 30 hours

1. Phone-first on the iQOO device; the final demonstration runs on it.
2. Wire and verify the Snapdragon NPU delegate for the embedding step — hardware-accelerated, fully offline.
3. Widen the fixture toward the full 48-case metrics set; publish real ablation numbers at scale.
4. Reversal-of-approval flow + second-approver tier: a frozen mapping can be un-approved, the run recomputes, and the audit log records the reversal rather than erasing the original.
5. Stretch: voice authorization.

---

## 21. Calibration & known limitations

- `HIGH = 0.62` was set once from the model's observed output on the three cases and frozen. MiniLM on bare names scores low; the description context is what lifts Case 2 over the threshold. If the fixture grows, `HIGH` should be re-derived once from a labelled sweep and re-frozen — never tuned per-case.
- `fuzzyScore` is deliberately weak (Dice over bigrams; no phonetic, no token alignment). It is the ablation baseline, not a shipping matcher.
- The netting model is central-clearing (one leg per non-zero net position). A bilateral or multilateral-with-limits model would produce different leg counts; the footnote on the Netting screen states the assumption so it is not challengeable.
- Single currency. Cross-currency netting needs an FX layer and settlement-date handling — out of scope.
- Three cases, six entities, ten obligations. Small on purpose (brief §16).

---

## 22. Verification

- `node test.mjs` → 22 passed.
- `python serve.py 8123`, open in a browser: no console errors, no horizontal overflow, five tabs render, the three cases score to `AUTO_MERGE` / `REVIEW_REQUIRED` / `KEEP_SEPARATE`.
- Approve Case 2 → the netting numbers change and the graph re-wires (on the wide layout, without navigating).
- Cut the network → a Live run still resolves; fonts still render (proves self-hosting).
- Both breakpoints: ~390 px and ~1440 px. Cross 900 px repeatedly — the graph survives the slot move with its state intact.
