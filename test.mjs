// node test.mjs  — gate logic + netting math. No model needed.
import assert from "node:assert/strict";
import { normalize, fuzzyScore, idCheck, gate, net, HIGH, ablationRoute, scoreAblation, FUZZY_CANDIDATE, netByCurrency, RATES, exposureOf, DUAL_CONTROL_THRESHOLD } from "./pipeline.js";
import { OBLIGATIONS, ENTITIES } from "./fixture.js";
import { parseCSV, parseJSON, validateLedger, SAMPLE_CSV } from "./import.js";

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log(`  ok  ${name}`);
};

// --- normalization / fuzzy ---
t("alias expansion collapses Ltd/Limited + Pvt/Private", () => {
  assert.equal(normalize("Orbit Comms Pvt Ltd").normalized, normalize("Orbit Comms Private Limited").normalized);
});
t("fuzzy: near-identical strings score high", () => {
  assert.ok(fuzzyScore("Orbit Communication India Private Limited", "Orbit Communications India Pvt Ltd") > 0.8);
});
t("fuzzy: unrelated brand vs legal name scores low", () => {
  assert.ok(fuzzyScore("Sunrise Digital Services", "Orbit Communications India Pvt Ltd") < 0.3);
});

// --- idCheck ---
t("idCheck match / conflict / absent", () => {
  const g = (v) => ({ type: "GSTIN", value: v });
  assert.equal(idCheck(g("29AABCM1234K1Z5"), g("29aabcm1234k1z5")), "match");
  assert.equal(idCheck(g("33AAECO7788Q1Z2"), g("27AAECO1122P1Z9")), "conflict");
  assert.equal(idCheck(null, g("X")), "absent");
  assert.equal(idCheck({ type: "GSTIN", value: "X" }, { type: "VENDOR_ID", value: "X" }), "absent");
});

// --- gate: the three outcomes + the two deliberate edges ---
t("gate: exact ID match -> AUTO_MERGE regardless of semantic", () => {
  assert.equal(gate({ semanticScore: 0.1, idStatus: "match", evidence: {} }).decision, "AUTO_MERGE");
});
t("gate: ID conflict -> KEEP_SEPARATE even with very high semantic", () => {
  assert.equal(gate({ semanticScore: 0.99, idStatus: "conflict", evidence: { sameDomain: true } }).decision, "KEEP_SEPARATE");
});
t("gate: no ID, high semantic, corroboration -> REVIEW_REQUIRED", () => {
  assert.equal(gate({ semanticScore: HIGH + 0.05, idStatus: "absent", evidence: { postMerger: true } }).decision, "REVIEW_REQUIRED");
});
t("gate: no ID, high semantic, ZERO corroboration -> KEEP_SEPARATE (deliberate, spec §5 implicit)", () => {
  assert.equal(gate({ semanticScore: HIGH + 0.2, idStatus: "absent", evidence: {} }).decision, "KEEP_SEPARATE");
});
t("gate: no ID, low semantic -> KEEP_SEPARATE", () => {
  assert.equal(gate({ semanticScore: HIGH - 0.1, idStatus: "absent", evidence: { sameDomain: true } }).decision, "KEEP_SEPARATE");
});

// --- netting math (spec §7) ---
const resolved = new Set(ENTITIES);

t("net: excludes obligations with unresolved counterparties", () => {
  const r = net(OBLIGATIONS, {}, resolved);
  assert.equal(r.excludedCount, 2); // o9 (cp-sunrise), o10 (cp-orbit-cbe)
});

t("net: gross = sum of included obligations", () => {
  const r = net(OBLIGATIONS, {}, resolved);
  const included = OBLIGATIONS.filter((o) => resolved.has(o.from) && resolved.has(o.to));
  assert.equal(r.gross, included.reduce((s, o) => s + o.amount, 0));
});

t("net: sum of net positions is zero, netSettlementVolume = sum|pos|/2", () => {
  const r = net(OBLIGATIONS, {}, resolved);
  const sum = Object.values(r.positions).reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(sum) < 0.001);
  const manual = Object.values(r.positions).reduce((s, p) => s + Math.abs(p), 0) / 2;
  assert.ok(Math.abs(manual - r.netSettlementVolume) < 0.001);
});

t("net: netting reduces settlement volume vs gross", () => {
  const r = net(OBLIGATIONS, {}, resolved);
  assert.ok(r.netSettlementVolume < r.gross);
  assert.ok(r.reductionPct > 0 && r.reductionPct < 100);
});

t("net: approving Case 2 mapping pulls cp-sunrise into the run", () => {
  const before = net(OBLIGATIONS, {}, resolved);
  const after = net(OBLIGATIONS, { "cp-sunrise": "orbit" }, resolved);
  assert.equal(after.excludedCount, before.excludedCount - 1); // o9 now included
  assert.ok(after.gross > before.gross);
});

t("net: legsAfter never exceeds legsBefore", () => {
  const r = net(OBLIGATIONS, { "cp-sunrise": "orbit" }, resolved);
  assert.ok(r.legsAfter <= r.legsBefore);
});

t("net: edges carry resolved endpoints; approved mapping rewrites them", () => {
  const r = net(OBLIGATIONS, { "cp-sunrise": "orbit" }, resolved);
  const o9 = r.edges.find((e) => e.id === "o9");
  assert.equal(o9.from, "orbit");            // resolved from cp-sunrise
  assert.equal(o9.rawFrom, "cp-sunrise");    // original preserved for animation
  assert.ok(r.edges.every((e) => resolved.has(e.from) && resolved.has(e.to)));
  assert.ok(r.excludedEdges.some((e) => e.id === "o10"));
});

// --- multi-currency (netByCurrency wraps net(), which stays untouched) ---
t("netByCurrency: groups by currency, each group nets independently of the others", () => {
  const r = netByCurrency(OBLIGATIONS, {}, resolved);
  const currencies = Object.keys(r.perCurrency).sort();
  assert.deepEqual(currencies, ["AED", "EUR", "INR", "USD"]);
  // the 3-obligation USD cycle (o11-o13) nets down; INR's own reduction is untouched by USD/EUR/AED existing
  assert.ok(r.perCurrency.USD.netSettlementVolume < r.perCurrency.USD.gross);
});

t("netByCurrency: a lone obligation in a currency has nothing to net against", () => {
  const r = netByCurrency(OBLIGATIONS, {}, resolved);
  assert.equal(r.perCurrency.AED.netSettlementVolume, r.perCurrency.AED.gross);
  assert.equal(r.perCurrency.AED.reductionPct, 0);
});

t("netByCurrency: base-currency headline is a fixed-rate rollup, not cross-currency netting", () => {
  const r = netByCurrency(OBLIGATIONS, {}, resolved);
  const expectedGrossBase = Object.entries(r.perCurrency)
    .reduce((sum, [ccy, run]) => sum + run.gross * (RATES[ccy] ?? 1), 0);
  assert.ok(Math.abs(r.grossBase - expectedGrossBase) < 0.01);
  assert.equal(r.baseCurrency, "INR");
});

t("netByCurrency: legs and excluded count sum across currencies", () => {
  const r = netByCurrency(OBLIGATIONS, {}, resolved);
  const sumLegsBefore = Object.values(r.perCurrency).reduce((s, run) => s + run.legsBefore, 0);
  assert.equal(r.legsBefore, sumLegsBefore);
  assert.equal(r.excludedCount, 2); // still just o9/o10 — the new currency obligations are all fully resolved
});

// --- dual control (exposureOf feeds the second-approver gate in app.js) ---
t("exposureOf: sums every obligation naming the counterparty on either side", () => {
  const exposure = exposureOf(OBLIGATIONS, "cp-sunrise");
  assert.equal(exposure, 840_000); // o9 only
  assert.ok(exposure >= DUAL_CONTROL_THRESHOLD);
});

t("exposureOf: zero for a counterparty with no obligations", () => {
  assert.equal(exposureOf(OBLIGATIONS, "cp-meridian-alt"), 0);
});

// --- ablation routing (spec §12) ---
t("ablationRoute: exact ID -> AUTO_MERGE in both configs", () => {
  const base = { fuzzy: 0.1, semantic: 0.1, idStatus: "match", evidence: {} };
  assert.equal(ablationRoute({ ...base, useEmbedding: false }), "AUTO_MERGE");
  assert.equal(ablationRoute({ ...base, useEmbedding: true }), "AUTO_MERGE");
});
t("ablationRoute: ID conflict -> KEEP_SEPARATE in both configs", () => {
  const base = { fuzzy: 0.95, semantic: 0.95, idStatus: "conflict", evidence: { sameDomain: true } };
  assert.equal(ablationRoute({ ...base, useEmbedding: false }), "KEEP_SEPARATE");
  assert.equal(ablationRoute({ ...base, useEmbedding: true }), "KEEP_SEPARATE");
});
t("ablationRoute: low fuzzy + high semantic + flag -> fuzzy-only SEPARATES, full REVIEWS", () => {
  const base = { fuzzy: 0.12, semantic: HIGH + 0.1, idStatus: "absent", evidence: { postMerger: true } };
  assert.equal(ablationRoute({ ...base, useEmbedding: false }), "KEEP_SEPARATE"); // the false separation
  assert.equal(ablationRoute({ ...base, useEmbedding: true }), "REVIEW_REQUIRED");
});
t("ablationRoute: strong string match with no flags -> REVIEW (both), no false merge", () => {
  const base = { fuzzy: FUZZY_CANDIDATE + 0.35, semantic: 0.2, idStatus: "absent", evidence: {} };
  assert.equal(ablationRoute({ ...base, useEmbedding: false }), "REVIEW_REQUIRED");
});
t("ablationRoute: nothing to go on -> KEEP_SEPARATE", () => {
  const base = { fuzzy: 0.2, semantic: 0.2, idStatus: "absent", evidence: {} };
  assert.equal(ablationRoute({ ...base, useEmbedding: true }), "KEEP_SEPARATE");
});

t("scoreAblation: counts false merges / separations and recovered relationships", () => {
  const rows = [
    { truth: "merge", fuzzyOnly: "AUTO_MERGE", full: "AUTO_MERGE" },
    { truth: "review", fuzzyOnly: "KEEP_SEPARATE", full: "REVIEW_REQUIRED" }, // recovered
    { truth: "review", fuzzyOnly: "REVIEW_REQUIRED", full: "REVIEW_REQUIRED" },
    { truth: "separate", fuzzyOnly: "KEEP_SEPARATE", full: "KEEP_SEPARATE" },
    { truth: "merge", fuzzyOnly: "AUTO_MERGE", full: "KEEP_SEPARATE" }, // full false separation
  ];
  const r = scoreAblation(rows);
  assert.equal(r.fuzzyOnly.falseMerge, 0);
  assert.equal(r.full.falseMerge, 0);
  assert.equal(r.fuzzyOnly.falseSep, 1);   // the recovered review case
  assert.equal(r.full.falseSep, 1);        // the merge routed to separate
  assert.equal(r.recovered.length, 1);
  assert.ok(r.full.reviewRecall > r.fuzzyOnly.reviewRecall);
});

// --- ledger import (spec: CSV/JSON, validated, nothing silently dropped) ---
t("parseCSV + validateLedger: SAMPLE_CSV catches the duplicate id and the self-reference", () => {
  const r = validateLedger(parseCSV(SAMPLE_CSV));
  assert.equal(r.obligations.length, 4); // imp1, imp2, first imp3, imp5 — second imp3 and imp4 rejected
  assert.ok(r.errors.some((e) => e.message.includes("duplicate obligation id")));
  assert.ok(r.errors.some((e) => e.message.includes("same entity")));
  assert.deepEqual(r.entities.map((e) => e.id), ["haldane", "riverside", "solace", "vasant"]);
});

t("validateLedger: non-numeric amount and missing fields are rejected, not silently dropped", () => {
  const r = validateLedger({
    entities: null,
    obligations: [
      { row: 1, id: "a", from: "x", to: "y", amount: "not-a-number" },
      { row: 2, id: "b", from: "x", to: "", amount: 100 },
      { row: 3, id: "c", from: "x", to: "y", amount: -5 },
    ],
  });
  assert.equal(r.obligations.length, 0);
  assert.equal(r.errors.length, 3);
});

t("validateLedger: an explicit entities roster rejects an obligation naming an unknown id", () => {
  const r = validateLedger({
    entities: [{ id: "x", label: "X" }, { id: "y", label: "Y" }],
    obligations: [{ row: 1, id: "a", from: "x", to: "z", amount: 100 }],
  });
  assert.equal(r.obligations.length, 0);
  assert.ok(r.errors[0].message.includes("unknown entity id"));
});

t("parseJSON: accepts a bare obligations array or an {obligations} object", () => {
  const bare = parseJSON(JSON.stringify([{ id: "a", from: "x", to: "y", amount: 10 }]));
  const wrapped = parseJSON(JSON.stringify({ obligations: [{ id: "a", from: "x", to: "y", amount: 10 }] }));
  assert.equal(bare.obligations.length, 1);
  assert.equal(wrapped.obligations.length, 1);
});

console.log(`\n${pass} passed`);
