// node test.mjs  — gate logic + netting math. No model needed.
import assert from "node:assert/strict";
import { normalize, fuzzyScore, idCheck, gate, net, HIGH } from "./pipeline.js";
import { OBLIGATIONS, ENTITIES } from "./fixture.js";

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

console.log(`\n${pass} passed`);
