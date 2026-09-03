// Lumine matching pipeline — pure logic, no DOM, no model import.
// Importable from both the browser (app.js) and node (test.mjs).

// ---------------------------------------------------------------------------
// Layer 1: deterministic normalization
// ---------------------------------------------------------------------------

const ALIASES = {
  "pvt": "private",
  "pvt.": "private",
  "ltd": "limited",
  "ltd.": "limited",
  "co": "company",
  "co.": "company",
  "corp": "corporation",
  "corp.": "corporation",
  "&": "and",
  "intl": "international",
  "inc": "incorporated",
  "inc.": "incorporated",
};

// Tokens that carry no identifying signal — dropped before overlap scoring.
const STOPWORDS = new Set(["private", "limited", "company", "corporation", "incorporated", "india", "the"]);

export function normalize(name) {
  const raw = (name || "").toLowerCase().replace(/[.,]/g, " ").replace(/[^\p{L}\p{N}&\s-]/gu, " ");
  const expanded = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ALIASES[t] ?? t);
  const tokens = expanded.filter((t) => !STOPWORDS.has(t));
  return { normalized: expanded.join(" "), tokens };
}

// Dice coefficient over character bigrams of the significant tokens.
export function fuzzyScore(a, b) {
  const sa = normalize(a).tokens.join(" ");
  const sb = normalize(b).tokens.join(" ");
  const bg = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  if (sa.length < 2 || sb.length < 2) return sa === sb ? 1 : 0;
  const ma = bg(sa);
  const mb = bg(sb);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ma) {
    total += n;
    overlap += Math.min(n, mb.get(g) || 0);
  }
  for (const n of mb.values()) total += n;
  return (2 * overlap) / total;
}

// ---------------------------------------------------------------------------
// Layer 3: authoritative identity check
// ---------------------------------------------------------------------------

// idA / idB: { type: "GSTIN"|"VENDOR_ID"|..., value: string } or null.
// Returns "match" | "conflict" | "absent".
export function idCheck(idA, idB) {
  if (!idA || !idB || !idA.value || !idB.value) return "absent";
  if (idA.type !== idB.type) return "absent";
  return idA.value.trim().toUpperCase() === idB.value.trim().toUpperCase() ? "match" : "conflict";
}

// ---------------------------------------------------------------------------
// Governance gate (spec §5)
// ---------------------------------------------------------------------------

export const HIGH = 0.62; // calibrated once against the model's real output; see plan Risks.

// evidence: { sameDomain?: bool, postMerger?: bool, recurringDescription?: bool }
const FLAG_LABELS = {
  sameDomain: "same corporate domain",
  postMerger: "post-merger metadata",
  recurringDescription: "recurring settlement description",
};
export function corroboratingFlags(evidence = {}) {
  return Object.keys(FLAG_LABELS).filter((k) => evidence[k]).map((k) => FLAG_LABELS[k]);
}

// Returns { decision, authority, reason }.
//   decision: "AUTO_MERGE" | "REVIEW_REQUIRED" | "KEEP_SEPARATE"
export function gate({ semanticScore, idStatus, evidence = {} }) {
  if (idStatus === "match") {
    return {
      decision: "AUTO_MERGE",
      authority: "rule",
      reason: "Authoritative identifier matches exactly with no conflict. Semantic score is recorded for audit but plays no role in this decision.",
    };
  }
  if (idStatus === "conflict") {
    return {
      decision: "KEEP_SEPARATE",
      authority: "rule",
      reason: "Authoritative identifiers conflict. An ID conflict overrides semantic confidence — the names may look alike but the identifiers say these are different entities.",
    };
  }
  // No authoritative ID — semantic path.
  const flags = corroboratingFlags(evidence);
  if (semanticScore >= HIGH && flags.length > 0) {
    return {
      decision: "REVIEW_REQUIRED",
      authority: "rule",
      reason: `Review required: names have low lexical overlap, semantic similarity is high (${semanticScore.toFixed(2)}), ${flags.length} corroborating signal(s) present, and no authoritative identifier is available.`,
    };
  }
  if (semanticScore >= HIGH && flags.length === 0) {
    // Deliberate call — spec §5 leaves this branch implicit. Default to separation
    // unless identity is corroborated. See plan.
    return {
      decision: "KEEP_SEPARATE",
      authority: "rule",
      reason: "Keep separate: semantic similarity is high but no corroborating context or identifier is available. Lumine defaults to separation unless identity is corroborated.",
    };
  }
  return {
    decision: "KEEP_SEPARATE",
    authority: "rule",
    reason: `Keep separate: semantic similarity (${semanticScore.toFixed(2)}) is below the review threshold and no authoritative identifier links these entities.`,
  };
}

// Plain-language "Why" line — templated from fields the pipeline already computes.
// This explains the governance decision, NOT the embedding model's internals.
export function whyText({ fuzzy, semanticScore, idStatus, evidence = {} }) {
  const flags = corroboratingFlags(evidence);
  const lexical = fuzzy >= 0.6 ? "high lexical overlap" : fuzzy >= 0.3 ? "partial lexical overlap" : "low lexical overlap";
  const parts = [`The names have ${lexical}`];
  if (idStatus === "match") parts.push("and an authoritative identifier matches exactly");
  else if (idStatus === "conflict") parts.push("but the authoritative identifiers conflict");
  else parts.push("and no authoritative identifier is available");
  if (evidence.postMerger) parts.push("settlement metadata indicates a post-merger relationship");
  if (evidence.sameDomain) parts.push("the corporate domain is consistent");
  if (evidence.recurringDescription) parts.push("the settlement description recurs across periods");
  if (semanticScore != null) parts.push(`semantic similarity is ${semanticScore.toFixed(2)}`);
  return parts.join(", ") + ".";
}

// ---------------------------------------------------------------------------
// Deterministic netting engine (spec §7)
// ---------------------------------------------------------------------------

// obligations: [{ id, from, to, amount }]  — from owes `to` `amount`
// mapping: { [counterpartyId]: canonicalEntityId }  — approved merges
// entities: canonical entity ids that are "resolved" (in the entity map)
//
// Abstention = exclusion: an obligation whose from/to is not a resolved entity
// (and not covered by an approved mapping) is dropped from the run.
export function net(obligations, mapping, resolvedEntities) {
  const resolve = (c) => mapping[c] ?? c;
  const isResolved = (c) => resolvedEntities.has(resolve(c));

  const included = [];
  const excluded = [];
  for (const o of obligations) {
    if (isResolved(o.from) && isResolved(o.to)) included.push(o);
    else excluded.push(o);
  }

  const gross = included.reduce((s, o) => s + o.amount, 0);

  const positions = new Map(); // entityId -> net position (receivables - payables)
  for (const o of included) {
    const f = resolve(o.from);
    const t = resolve(o.to);
    positions.set(f, (positions.get(f) || 0) - o.amount);
    positions.set(t, (positions.get(t) || 0) + o.amount);
  }

  const netSettlementVolume = [...positions.values()].reduce((s, p) => s + Math.abs(p), 0) / 2;
  const reductionPct = gross === 0 ? 0 : ((gross - netSettlementVolume) / gross) * 100;

  // Payment legs, central-clearing model: before = included obligation count;
  // after = number of entities with a non-zero net position.
  const legsBefore = included.length;
  const legsAfter = [...positions.values()].filter((p) => Math.abs(p) > 0.005).length;

  return {
    gross,
    netSettlementVolume,
    reductionPct,
    legsBefore,
    legsAfter,
    excludedCount: excluded.length,
    positions: Object.fromEntries(positions),
  };
}
