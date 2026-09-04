// Synthetic demo data. Single currency (INR). Small on purpose (plan §scope).

// Three scripted review cases — one per governance outcome.
export const CASES = [
  {
    id: 1,
    source: {
      name: "Meridian Logistics Ltd",
      context: "Freight forwarding and warehousing. Settlement account MERID-4471.",
      id: { type: "GSTIN", value: "29AABCM1234K1Z5" },
    },
    candidate: {
      name: "Meridian Logistics Limited",
      context: "Logistics and supply-chain services. Vendor master entry, Chennai.",
      id: { type: "GSTIN", value: "29AABCM1234K1Z5" },
    },
    evidence: { sameDomain: false, postMerger: false, recurringDescription: true },
    counterpartyId: "cp-meridian-alt", // maps to entity "meridian" on approval
    canonicalEntity: "meridian",
    expected: "AUTO_MERGE",
  },
  {
    id: 2,
    source: {
      name: "Sunrise Digital Services",
      context: "Payment memo notes 'part of the Orbit group post-acquisition'. Contact domain orbitcomm.in. Recurring monthly settlement, same description each period.",
      id: null,
    },
    candidate: {
      name: "Orbit Communications India Pvt Ltd",
      context: "Telecom and digital services provider. Corporate domain orbitcomm.in. Acquired Sunrise Digital in 2024.",
      id: null,
    },
    evidence: { sameDomain: true, postMerger: true, recurringDescription: true },
    counterpartyId: "cp-sunrise",
    canonicalEntity: "orbit",
    expected: "REVIEW_REQUIRED",
  },
  {
    id: 3,
    source: {
      name: "Orbit Communication India Private Limited",
      context: "Regional ISP, Coimbatore. Settlement account ORBIT-C-991.",
      id: { type: "GSTIN", value: "33AAECO7788Q1Z2" },
    },
    candidate: {
      name: "Orbit Communications India Pvt Ltd",
      context: "Telecom and digital services provider, national. Corporate domain orbitcomm.in.",
      id: { type: "GSTIN", value: "27AAECO1122P1Z9" },
    },
    evidence: { sameDomain: false, postMerger: false, recurringDescription: false },
    counterpartyId: "cp-orbit-cbe",
    canonicalEntity: "orbit",
    expected: "KEEP_SEPARATE",
  },
];

// Six legal entities in the netting group.
export const ENTITIES = ["meridian", "orbit", "north-star", "veritas", "cobalt", "harbor"];

// Display names + graph layout. Entities sit on a circle; unresolved
// counterparties float below until an approved mapping pulls them in.
export const NODE_LABELS = {
  meridian: "Meridian", orbit: "Orbit", "north-star": "North Star",
  veritas: "Veritas", cobalt: "Cobalt", harbor: "Harbor",
  "cp-sunrise": "Sunrise Digital", "cp-orbit-cbe": "Orbit (Coimbatore)",
};

// Counterparties not in the entity map at the start of the run.
export const UNRESOLVED = ["cp-sunrise", "cp-orbit-cbe"];

// Intercompany obligations (INR). `from` owes `to`.
// Two obligations reference unresolved counterparties (cp-sunrise, cp-orbit-cbe)
// so the "abstention = exclusion" behaviour is visible, and approving Case 2
// pulls cp-sunrise into the run.
export const OBLIGATIONS = [
  { id: "o1", from: "meridian", to: "orbit", amount: 1_250_000 },
  { id: "o2", from: "orbit", to: "north-star", amount: 900_000 },
  { id: "o3", from: "north-star", to: "meridian", amount: 1_100_000 },
  { id: "o4", from: "veritas", to: "orbit", amount: 640_000 },
  { id: "o5", from: "cobalt", to: "veritas", amount: 380_000 },
  { id: "o6", from: "harbor", to: "cobalt", amount: 520_000 },
  { id: "o7", from: "orbit", to: "harbor", amount: 300_000 },
  { id: "o8", from: "meridian", to: "veritas", amount: 210_000 },
  { id: "o9", from: "cp-sunrise", to: "north-star", amount: 840_000 }, // unresolved until Case 2 approved
  { id: "o10", from: "cp-orbit-cbe", to: "north-star", amount: 700_000 }, // stays unresolved (Case 3 kept separate). Sized so that wrongly approving the ID-conflict match shows a visible (and misdirected) netting change.
];

// ---------------------------------------------------------------------------
// Held-out labelled set for the ablation (spec §12): fuzzy-only vs fuzzy+embedding.
// truth: "merge" (exact identity) | "review" (real relationship, needs a human)
//        | "separate" (no relationship, or identity conflict)
// The rebrand / brand-vs-legal-name pairs have deliberately low string overlap:
// fuzzy-only should route them to KEEP_SEPARATE (a false separation), the
// embedding layer should surface them for review. Neither config should ever
// produce a false merge.
// ---------------------------------------------------------------------------
export const ABLATION_CASES = [
  { a: { name: "Apex Manufacturing Ltd", context: "Industrial fabrication and metal components." },
    b: { name: "Apex Manufacturing Limited", context: "Metal components manufacturer, vendor master." },
    id: "match", evidence: { recurringDescription: true }, truth: "merge" },

  { a: { name: "Trinity Logistics Ltd", context: "Road freight and warehousing." },
    b: { name: "Trinity Logistics Limited", context: "Freight forwarding, vendor master entry." },
    id: "match", evidence: {}, truth: "merge" },

  { a: { name: "Kestrel Freight", context: "Container haulage. Settlement account KES-220." },
    b: { name: "Kestrel Logistics Solutions Pvt Ltd", context: "Logistics operator, vendor master." },
    id: "match", evidence: {}, truth: "merge" },

  { a: { name: "Nova Retail Pvt Ltd", context: "Consumer retail chain." },
    b: { name: "Nova Retail Private Limited", context: "Retail group, recurring monthly settlement." },
    id: "none", evidence: { recurringDescription: true }, truth: "review" },

  { a: { name: "BluePeak Software", context: "Enterprise software, domain bluepeak.io." },
    b: { name: "BluePeak Software Solutions", context: "Software services provider, domain bluepeak.io." },
    id: "none", evidence: { sameDomain: true }, truth: "review" },

  { a: { name: "Vertex Health Pvt Ltd", context: "Diagnostics laboratory network." },
    b: { name: "Vertex Health Pvt Ltd", context: "Diagnostics network, no authoritative ID on the settlement record." },
    id: "none", evidence: { recurringDescription: true }, truth: "review" },

  // --- low string overlap, real relationship: the embedding layer's job ---
  { a: { name: "Sunrise Digital Services", context: "Payment memo notes 'part of the Orbit group after acquisition'. Domain orbitcomm.in." },
    b: { name: "Orbit Communications India Pvt Ltd", context: "Telecom and digital services provider. Acquired Sunrise Digital in 2024. Domain orbitcomm.in." },
    id: "none", evidence: { postMerger: true, sameDomain: true }, truth: "review" },

  { a: { name: "Meadowbrook Foods", context: "Packaged foods producer. Rebranded to Greenfield Nutrition in 2024." },
    b: { name: "Greenfield Nutrition Corp", context: "Packaged foods and nutrition company, formerly Meadowbrook Foods." },
    id: "none", evidence: { postMerger: true, recurringDescription: true }, truth: "review" },

  { a: { name: "Orion Media", context: "On-air broadcast brand. Operated by Pinnacle Broadcasting." },
    b: { name: "Pinnacle Broadcasting Ltd", context: "Television and radio broadcaster. Orion Media is its consumer-facing channel brand. Domain pinnaclebc.in." },
    id: "none", evidence: { sameDomain: true }, truth: "review" },

  { a: { name: "Southgate Retail", context: "Apparel retailer. Operates under Meridian Consumer Brands after the 2023 acquisition." },
    b: { name: "Meridian Consumer Brands", context: "Consumer brands holding company. Southgate Retail is one of its apparel banners." },
    id: "none", evidence: { postMerger: true }, truth: "review" },

  // --- conflicts and genuine non-matches: both configs must keep separate ---
  { a: { name: "Delta Components Ltd", context: "Automotive parts supplier, GSTIN 27AAECD1234A1Z1." },
    b: { name: "Delta Components Ltd", context: "Electrical components distributor, GSTIN 29AAECD9988B1Z4." },
    id: "conflict", evidence: {}, truth: "separate" },

  { a: { name: "Orbit Communication India Private Limited", context: "Regional ISP, Coimbatore. GSTIN 33AAECO7788Q1Z2." },
    b: { name: "Orbit Communications India Pvt Ltd", context: "National telecom operator. GSTIN 27AAECO1122P1Z9." },
    id: "conflict", evidence: {}, truth: "separate" },

  { a: { name: "Ironwood Capital", context: "Family office, Mumbai. Private wealth management." },
    b: { name: "Redwood Advisory Group", context: "Corporate finance advisory, unrelated firm." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Cobalt Systems", context: "Data centre hardware. No relationship to other counterparties." },
    b: { name: "Cobalt Analytics", context: "Marketing analytics SaaS, unrelated company." },
    id: "none", evidence: {}, truth: "separate" },
];
