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
