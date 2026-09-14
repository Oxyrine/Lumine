# Lumine — Specification

*Originally built for iQOO Hackathon 2026 (Chennai City Battle); continued afterward as a
standalone product. This document describes what exists now.*

Live: https://lumine-opal.vercel.app · Mirror: https://oxyrine.github.io/Lumine/ · Repo: github.com/Oxyrine/Lumine

---

## 0. What this document is

The specification for Lumine as built: the pipeline, the governance gate, the netting
engine, the screens, and the decisions behind each. Where a design choice isn't obvious
from the code, it's explained here (search **Deviation** for the one place behavior
deliberately diverges from what a naive reading of the governance rules would suggest).

---

## 1. Thesis

**AI proposes. Evidence corroborates. Humans authorize. Only then does the identity enter netting.**

Lumine resolves whether two counterparty names refer to the same legal entity — the step a
corporate treasury must get right before netting intercompany and vendor obligations.
Merging two entities that are not the same makes the netting engine offset obligations that
should not offset, which misdirects a real payment.

The model never decides. It surfaces candidates. A deterministic gate and a human decide.
The default is separation; an identity enters a netting run only when its identity is
corroborated by something other than model confidence.

---

## 2. Scope

In scope:
- The full matching pipeline, running locally in the browser
- Three scripted review cases, one per governance outcome
- Free-form live input
- A deterministic netting run that recomputes as identities are authorized, grouped by
  currency
- A second-approver (dual-control) tier for high-exposure counterparties
- Reversal of an approved or separated decision, with a compensating audit entry
- CSV/JSON ledger import, validated on-device, replacing the sample run until reset
- A held-out ablation (48 pairs) proving the embedding layer's contribution
- An audit log
- A visible offline demonstration

Out of scope — see §19.

Data is synthetic (`fixture.js`): 6 legal entities, 16 intercompany obligations across 4
currencies (INR, USD, EUR, AED), 3 review cases, 48 held-out ablation pairs.

---

## 3. The pipeline

Five layers. Layers 1, 3, 4, 5 are deterministic and run identically in Node and the
browser (`pipeline.js` — no DOM, no model import). Layer 2 is the only ML step and runs
only in the browser.

```
name + context
  │
  ▼  L1  Normalization ......... alias expansion, tokenization, character-bigram fuzzy score
  ▼  L2  On-device semantic .... MiniLM sentence embedding, cosine similarity   (browser only)
  ▼  L3  Authoritative ID ...... exact GSTIN comparison → match | conflict | absent
  ▼  L4  Governance gate ....... deterministic decision (§7)
  ▼  L5  Netting .............. deterministic, resolved identities only, per currency (§8)
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
- `loadModel()` clears its cached promise on rejection, so a failed load (blocked CDN, dead network) can be retried instead of permanently bricking the page.
- `embed()` caches by exact input string, so re-running the 48-pair ablation doesn't re-embed text it has already seen.

A Snapdragon NPU delegate for this same architecture is a known follow-up (§19) — not built, since it needs the physical hardware to verify against.

---

## 6. Layer 3 — Authoritative ID check

`idCheck(idA, idB)` over `{ type, value }` pairs (GSTIN in the fixture):
- both present, same type, values equal (case-insensitive, trimmed) → `match`
- both present, same type, values differ → `conflict`
- either absent, or types differ → `absent`

---

## 7. Layer 4 — The governance gate

`HIGH = 0.62` — the semantic-similarity threshold. Calibrated once against the model's real output and frozen; unchanged when the ablation fixture grew from 14 to 48 pairs (§9) because the fuller fixture still produces zero false merges and full review recall at this value — there was nothing to re-tune.

Corroborating flags (`corroboratingFlags(evidence)`): `same corporate domain`, `post-merger metadata`, `recurring settlement description`. At least one must be present for the semantic path to reach a human.

| Condition | Decision | Authority |
|---|---|---|
| ID `match` | `AUTO_MERGE` | rule — semantic score recorded for audit, plays no role |
| ID `conflict` | `KEEP_SEPARATE` | rule — **overrides semantic confidence entirely** |
| ID `absent`, semantic ≥ HIGH, ≥1 corroborating flag | `REVIEW_REQUIRED` | rule → routed to a human |
| ID `absent`, semantic ≥ HIGH, **zero** corroborating flags | `KEEP_SEPARATE` | rule — **deliberate** |
| ID `absent`, semantic < HIGH | `KEEP_SEPARATE` | rule |

**Deviation:** the fourth row is easy to miss on a first read of a governance table like this — high model confidence alone looks like it should be enough to involve a human. It deliberately is not. The system defaults to separation unless identity is corroborated by something independent of the model. The on-screen "Why" line says this in plain language: *"Keep separate: semantic similarity is high but no corroborating context or identifier is available. Lumine defaults to separation unless identity is corroborated."*

A merge that clears the gate but exceeds a per-counterparty exposure threshold gets a second check before it takes effect — see §7a.

### 7a. Dual control (second-approver tier)

`exposureOf(obligations, counterpartyId)` sums every obligation naming that counterparty on either side. `DUAL_CONTROL_THRESHOLD = ₹5,00,000`.

When a case's counterparty exposure is at or above the threshold, `AUTO_MERGE` and `REVIEW_REQUIRED` (not `KEEP_SEPARATE` — separation is the safe default and doesn't need extra scrutiny) route through a two-step approval instead of one:

1. First analyst approves → recorded as intent (`pendingApproval[counterpartyId]`), the mapping is **not** yet applied, and an audit line records the first sign-off.
2. A **different** analyst must approve again. The same analyst counter-approving is refused, visibly, with a reason. On a valid counter-approval the mapping freezes, the mapping version bumps, and the audit log records the counter-approval and the freeze.

The header's analyst switcher (Analyst A / Analyst B) exists to make this demonstrable without a second device.

---

## 8. Layer 5 — The netting engine

`net(obligations, mapping, resolvedEntities)`:

- **Abstention = exclusion.** An obligation whose `from` or `to` does not resolve (via an approved `mapping` entry) to a member of the entity set is dropped from the run.
- `gross` = Σ amount over included obligations.
- Per-entity `net position` = receivables − payables.
- `netSettlementVolume` = Σ |net position| / 2.
- `reductionPct` = (gross − netSettlementVolume) / gross × 100.
- Payment legs, central-clearing model: `legsBefore` = included obligation count; `legsAfter` = entities with a non-zero net position.

Fixture run, no approvals, INR: gross ₹53,00,000 → net settlement volume ₹8,30,000 (84.3% reduction), 8 → 6 legs, 2 obligations excluded.
After approving Case 2 (Sunrise → Orbit): gross ₹61,40,000 → ₹7,80,000 (87.3%), 9 → 6 legs, 1 excluded.

### 8a. Multi-currency

`net()` itself is untouched and currency-agnostic — it offsets whatever obligations it's handed as if they shared one currency. `netByCurrency(obligations, mapping, resolvedEntities, rates)` groups obligations by their `currency` field (absent = INR) and calls `net()` once per group, so **an INR payable and a USD payable are never netted against each other**; that would require a live FX feed and settlement-date handling this prototype doesn't have.

`RATES = { INR: 1, USD: 83, EUR: 90, AED: 22.6 }` — a fixed reference table, stated everywhere it's shown as **not a live feed** — is only used to roll each currency's own net figure into one glanceable INR headline. The Netting screen's per-currency table shows each currency's own gross/net/reduction; a currency with only one obligation (AED in the fixture) shows correctly as 0% reduction — there's nothing to net it against.

---

## 9. The ablation — does the embedding layer earn its place?

`FUZZY_CANDIDATE = 0.5` — string-similarity at or above this makes a pair a merge candidate for the deterministic-only pipeline.

48 labelled pairs (`ABLATION_CASES`), each `truth ∈ {merge, review, separate}`, deliberately adversarial (same trading name across different-state GSTINs, holding-vs-subsidiary pairs, transliteration/spelling variants, shared-prefix conglomerate names, genuinely-unrelated pairs with high lexical overlap). Two pipeline configurations, **same gate**:
- **fuzzy-only** — Layers 1 + 3. Candidate iff `fuzzy ≥ 0.5`.
- **fuzzy + embedding** — adds Layer 2. Candidate iff `fuzzy ≥ 0.5` OR `semantic ≥ HIGH`.

Metrics (`scoreAblation`):
- **false merges** — routed `AUTO_MERGE`, truth ≠ merge. The safety metric. Financially dangerous.
- **false separations** — routed `KEEP_SEPARATE`, truth ∈ {merge, review}. Efficiency cost.
- **review-routing recall** — of the `review` pairs, the fraction routed `REVIEW_REQUIRED`.

Computed live, on-device, in the Proof screen. Current result on the 48-case fixture:

| | fuzzy-only | fuzzy + embedding |
|---|---|---|
| false merges | 0 | 0 |
| false separations | 8 | 0 |
| review-routing recall | 53% | 100% |

Widening the fixture from 14 adversarial-free pairs to 48 deliberately adversarial ones moved the fuzzy-only baseline's recall up (43% → 53% — the larger set happens to contain more pairs fuzzy matching alone can catch) without moving the full pipeline off zero false merges or full review recall. That's the result worth reporting, not the one that was predicted going in: the gate structurally cannot produce a false merge on this fixture (`AUTO_MERGE` only ever fires on `idStatus === "match"`, and no adversarial pair in the fixture carries a matching authoritative ID), so the two configurations only ever differ on *how many true relationships get surfaced for review*, not on safety.

The 8 recovered pairs include the original four (Sunrise↔Orbit, Meadowbrook↔Greenfield, Orion↔Pinnacle, Southgate↔Meridian Consumer) plus four holding/subsidiary pairs added when the fixture grew (Ashford, Marlow, Fernhill, Oakridge — a parent and its differently-branded subsidiary, near-zero string overlap, no shared identifier).

The Proof screen plots this: fuzzy (x) against semantic (y), y-axis clamped to 0.20–1.00 because MiniLM cosines never approach zero on real text. The shaded low-fuzzy / high-semantic quadrant, and the haloed points in it, are the recovered pairs — the visual statement of what the embedding sees that string matching cannot.

---

## 10. Screens

**Review** — the three scripted cases. The queue shows fuzzy / semantic / ID at a glance and the gate's badge. Cases the identifier decides (`match`, `conflict`) resolve without the model and say so ("the identifier decided this"). Tapping a case opens the split view: AI confidence (model) vs. gate decision (rule) as visibly separate quantities, the evidence ✓/✗ list, the plain "Why", the netting delta, and `[Keep separate] [Approve match]` — or, for a high-exposure counterparty, the dual-control variant of that button (§7a). Approving freezes a mapping version and writes an audit line. A prominent "Start the walkthrough" card narrates all three cases in order for a first-time visitor.

**Live** — two names, optional context, optional ID per side, three evidence checkboxes. Runs the six stages with visible progress. Any pair; the result is whatever the model and gate actually produce.

**Netting** — the draft run as a live entity graph (`graph.js`, pure SVG): entities on a ring, unresolved counterparties floating below with dashed excluded edges, net position on each node. Approving an identity re-wires the graph and rolls the settlement number; reversing one un-merges it, with a caption calling out the reversal rather than silently snapping back. Below the draft (INR) figures, a per-currency table (§8a) shows every currency in the ledger. Recomputes on every decision.

**Import** — upload a CSV or JSON settlement ledger; every row is validated on-device (missing fields, non-numeric or non-positive amounts, duplicate ids, self-referencing obligations, and — when the JSON carries an explicit entity roster — unknown entity ids), with every failure surfaced, never silently dropped. Applying swaps the Netting screen's graph and readout to the imported ledger (imported entities are pre-resolved by definition — there's no ambiguity to route through the Review queue for them); the Review queue's own governance demo is untouched by an active import, since it's a separate, self-contained pipeline walkthrough. Resetting returns to the sample ledger.

**Proof** — the ablation, plotted then tabulated (§9). "Run evaluation" computes all 48 pairs on-device.

**Audit** — every decision in the §14 format, plus the current-limitations list.

---

## 11. Responsive presentation — the stage

Below 900 px: the app is a 448 px column. The product.

At 900 px and above: `#app` becomes two columns — the phone in a device frame on the left, a companion panel on the right carrying the netting graph, the settlement number and the audit stream at projector size. The graph is a single instance moved between a slot inside the phone and a slot in the companion (`appendChild`, never re-created — `createGraph` has no teardown and its SVG `<marker>` id is document-global). Its layout is recomputed, not just moved, when a ledger import swaps the entity topology (`setTopology`, §8a/§10). Consequence is simultaneous on the wide layout: approve in the phone, the companion graph re-wires beside it with no navigation. On mobile the same moment plays when the Netting tab is opened (the graph is not rendered while its section is hidden, so the merge animation is saved for the reveal).

---

## 12. Cold open

A full-screen overlay over a laid-out app (never `display:none` — that would flash on dismiss; `<body>` scroll is locked while it is up, including on mobile touch-drag). Carries the wordmark, the thesis, and the model load as an event.

- **Cached** — resolves fast; the overlay is a ~450 ms title card. Status: "model already on this device." No fabricated delay.
- **Slow** — a real progress bar on actual bytes; at 6 s, a "Skip — explore the interface" button. The model keeps loading.
- **Failed** — the real error, a working **Retry** (possible because `loadModel` resets on rejection; disabled while the network is cut), and "Continue without the model."

`scoreIdCases()` runs synchronously at load: the two cases the identifier decides are scored before the model exists and regardless of whether it ever loads. Degraded mode is a working app.

---

## 13. Offline behaviour

- Model weights: cached by transformers.js in the Cache API after first load. Matching then runs with the network off.
- `sw.js` — a network-first service worker over the app shell (HTML, JS, CSS, fonts). Fresh files in dev, cache fallback offline. A page reload in airplane mode still works.
- **"Cut the network"** (header) — monkeypatches `window.fetch` and `XMLHttpRequest` to reject. A genuine block, not a simulation: the dot goes red, the status line changes, and a Live pipeline run still resolves against the loaded model. This proves the *matching step* makes no network call — distinct from the page load, which is ordinary web traffic.

---

## 14. Audit log format

Approval:
```
Match #<id> approved by <analyst> at HH:MM:SS IST
Evidence: semantic <0.xx>, <corroborating flags | "no corroborating context">, ID <status>
Result: mapping frozen (v<n>) for netting run #<run id>
```
Keep-separate:
```
Match #<id> kept separate by <analyst> at HH:MM:SS IST
Reason: <gate reason>
Result: obligation excluded from netting run #<run id>
```
Dual control (§7a) writes up to three lines for one match: the first approval (mapping not yet applied), the counter-approval by a different analyst, and the freeze.

Reversal: the original entry is marked reversed (rendered struck-through, never deleted or edited) and a new compensating entry is appended — `mappingVersion` only ever bumps forward.

Ledger import: an entry on apply (entity/obligation counts) and on reset back to the sample ledger.

Lines are rendered as text, never as markup — this holds for every audit kind, including ones sourced from imported (untrusted) data.

---

## 15. The three scripted cases

| # | Source | Candidate | IDs | Model semantic | Gate |
|---|---|---|---|---|---|
| 1 | Meridian Logistics Ltd | Meridian Logistics Limited | same GSTIN | ~0.67 (recorded, unused) | `AUTO_MERGE` |
| 2 | Sunrise Digital Services *(memo: "part of the Orbit group post-acquisition", domain orbitcomm.in, recurring monthly)* | Orbit Communications India Pvt Ltd *(telecom, orbitcomm.in, acquired Sunrise 2024)* | none | ~0.74 (≥ HIGH) | `REVIEW_REQUIRED` |
| 3 | Orbit Communication India Private Limited *(regional ISP, Coimbatore, GSTIN 33…)* | Orbit Communications India Pvt Ltd *(national, GSTIN 27…)* | **conflicting GSTIN** | ~0.75 (high — and ignored) | `KEEP_SEPARATE` |

Case 3 is the demonstration that matters: the model is *confident*, the strings are near-identical, and the ID conflict overrides both. Obligation `o10` (`cp-orbit-cbe → north-star`, ₹7,00,000) is sized so that wrongly approving this match produces a visible, misdirected −₹1,90,000 change in the netting run. Case 2's counterparty exposure (₹8,40,000) is above the dual-control threshold, so approving it demonstrates §7a rather than a single-step approval.

---

## 16. Data model (`fixture.js`)

Entities (6): `meridian`, `orbit`, `north-star`, `veritas`, `cobalt`, `harbor`.
Unresolved counterparties (2): `cp-sunrise` (→ `orbit` on Case 2 approval), `cp-orbit-cbe` (stays unresolved — Case 3 kept separate).
Obligations (16): `o1`–`o10` in INR between entities (`o9` `cp-sunrise → north-star` ₹8,40,000; `o10` `cp-orbit-cbe → north-star` ₹7,00,000); `o11`–`o13` in USD, `o14`–`o15` in EUR, `o16` in AED — all between already-resolved entities, so they never interact with the Review queue's unresolved counterparties.
Ablation pairs (48): `ABLATION_CASES`, each labelled `merge` / `review` / `separate` (§9).

A ledger imported via the Import screen (§10) replaces this dataset's obligations and entities for the Netting screen only, entirely client-side; it never touches `fixture.js`.

---

## 17. Architecture

- **No build step.** Plain ES modules, `<script type="module">`. No `package.json`, no bundler, no framework.
- Files: `index.html`, `styles.css`, `app.js` (one file — module-scope init order is load-bearing), `pipeline.js` (pure logic, imported by browser and Node), `embed.js`, `fixture.js`, `graph.js`, `scatter.js`, `import.js` (CSV/JSON ledger parsing and validation, no dependency), `sw.js`, `test.mjs`, `serve.py` (no-cache dev server, port 8123, `ThreadingHTTPServer` so concurrent asset requests don't serialize), `fonts/` (self-hosted, SIL OFL), `vercel.json`, `.nojekyll`.
- Fonts self-hosted because `sw.js` only caches same-origin — a CDN font would bypass the worker and break offline. Schibsted Grotesk (display), IBM Plex Mono (all numerals — the full upstream release; the Google CDN subset drops ₹ U+20B9).
- Deploy: Vercel (`lumine-opal.vercel.app`) and GitHub Pages (`oxyrine.github.io/Lumine`). Both zero-config static; `vercel.json` only forces `no-cache` on `sw.js`.
- Tests: `node test.mjs` — 32 assertions over gate outcomes, netting math (including multi-currency and dual-control exposure), ablation routing, and ledger import validation. Authoritative for logic; must stay green.

---

## 18. Design

Editorial-treasury system. White canvas, navy ink (`#0a2540`), one indigo voltage (`#4b3fd6` — CTA, active tab, links, focus), ochre (`#8a5a12` — the `REVIEW_REQUIRED` hold state), semantic green / red for net positions, a warm parchment framing band. Every financial figure in tabular IBM Plex Mono — the "trustworthy number" register shared across the Stripe / Coinbase / Binance systems. Fixed type steps, one hero per screen.

---

## 19. Current limitations

Stated on the Audit tab, not hidden:
- Voice authorization (§20 — the next thing to build)
- Snapdragon NPU delegate execution — needs the physical device to verify against; WASM here
- Real vendor-master / ERP integration — the Import screen's CSV/JSON parser (§10) is the
  honest stand-in; there is no live API connection
- Live FX feed for the multi-currency headline (§8a) — the conversion table is a fixed
  reference set, restated everywhere it's shown

This is a small, genuine list — not a scope statement for a submission deadline. Everything
else originally deferred (dual control, multi-currency netting, reversal, the 48-case
ablation fixture, CSV/JSON import) has since been built and is described in the sections
above.

---

## 20. Roadmap

**Voice authorization** — the analyst speaks "approve" or "keep separate"; the utterance is
transcribed on-device via `Xenova/whisper-tiny.en` (not the browser's native
`SpeechRecognition` — that API is server-backed and would silently violate the "nothing
leaves the device" claim §13's network-cut demonstration exists to prove), shown back for
confirmation before it applies, and the audit line records that it was a voice
authorization. The riskiest remaining item — if the audio plumbing doesn't cooperate, it's
cut; nothing else depends on it.

Past that: the Snapdragon NPU delegate (needs the physical hardware), a real ERP/vendor-master
connector in place of CSV/JSON import, and a live FX feed for the multi-currency headline —
each a materially larger undertaking than what's built so far, not a short follow-up.

---

## 21. Calibration & known limitations

- `HIGH = 0.62` was set once from the model's observed output and frozen. It was
  deliberately not re-tuned when the ablation fixture grew from 14 to 48 pairs (§9) — it
  still produces zero false merges and full review recall on the larger, adversarial set.
  Re-deriving `HIGH` is a one-time sweep against a labelled set, never a per-case tune.
- `fuzzyScore` is deliberately weak (Dice over bigrams; no phonetic, no token alignment). It is the ablation baseline, not a shipping matcher.
- The netting model is central-clearing (one leg per non-zero net position). A bilateral or multilateral-with-limits model would produce different leg counts; the footnote on the Netting screen states the assumption so it is not challengeable.
- Multi-currency netting never nets across currencies (§8a) — each currency is netted only against itself; the INR headline is a fixed-rate rollup for a single glanceable number.
- Three review cases, six entities. Small by design — the point is a legible walkthrough of the governance gate, not a stress test (the 48-case ablation fixture is where the stress test lives).

---

## 22. Verification

- `node test.mjs` → 32 passed.
- `python serve.py 8123`, open in a browser: no console errors, no horizontal overflow, six tabs render, the three cases score to `AUTO_MERGE` / `REVIEW_REQUIRED` / `KEEP_SEPARATE`.
- Approve Case 2 → dual control engages (§7a); after counter-approval the netting numbers change and the graph re-wires (on the wide layout, without navigating). Reverse it → numbers and graph return, both audit entries present, the original struck through.
- Run the 48-pair evaluation → completes without freezing the UI; the plot stays legible; the reported numbers match what `scoreAblation` actually returns (§9).
- Import a deliberately malformed ledger → every bad row is named, nothing is silently dropped; a valid import re-wires the graph to the new topology; reset restores the sample ledger's numbers exactly.
- Cut the network → a Live run still resolves; fonts still render (proves self-hosting).
- Both breakpoints: ~390 px and ~1440 px. Cross 900 px repeatedly — the graph survives the slot move with its state intact.
