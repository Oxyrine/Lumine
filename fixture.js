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

  // ---------------------------------------------------------------------------
  // Adversarial extension (34 pairs, 14 -> 48). Built to stress the gate rather
  // than flatter it — the metric that must hold under this is false merges (0),
  // not review-routing recall, which is allowed to fall well short of the
  // original 14-case set's 100%. See SPEC.md §9/§21.
  // ---------------------------------------------------------------------------

  // --- same trading name, different-state GSTIN: genuinely different entities
  // that happen to share a name. An ID conflict must win regardless of how
  // identical the strings look. ---
  { a: { name: "Sapphire Textiles Ltd", context: "Garment exporter, Tirupur. GSTIN 33AABCS4432F1Z8." },
    b: { name: "Sapphire Textiles Limited", context: "Home furnishings manufacturer, Ludhiana. GSTIN 03AABCS8871K1Z3." },
    id: "conflict", evidence: {}, truth: "separate" },

  { a: { name: "Continental Traders Pvt Ltd", context: "Commodity trading house, Kolkata. GSTIN 19AAFCC2244N1Z7." },
    b: { name: "Continental Traders Private Limited", context: "Import-export house, Chennai. GSTIN 33AAFCC9981M1Z2." },
    id: "conflict", evidence: {}, truth: "separate" },

  { a: { name: "Silverline Industries Ltd", context: "Precision tooling, Pune. GSTIN 27AABCS3321L1Z6." },
    b: { name: "Silverline Industries Limited", context: "Packaging solutions, Vadodara. GSTIN 24AABCS7765P1Z1." },
    id: "conflict", evidence: {}, truth: "separate" },

  { a: { name: "Bluewater Logistics Pvt Ltd", context: "Coastal shipping agent, Kochi. GSTIN 32AADCB5541Q1Z9." },
    b: { name: "Bluewater Logistics Private Limited", context: "Inland container depot, Jaipur. GSTIN 08AADCB1129R1Z4." },
    id: "conflict", evidence: {}, truth: "separate" },

  { a: { name: "Highland Agro Foods Ltd", context: "Tea processing, Darjeeling. GSTIN 19AABCH6612S1Z0." },
    b: { name: "Highland Agro Foods Limited", context: "Spice trading, Kochi. GSTIN 32AABCH2298T1Z5." },
    id: "conflict", evidence: {}, truth: "separate" },

  { a: { name: "Crestview Realty Pvt Ltd", context: "Commercial leasing, Gurugram. GSTIN 06AADCC7734U1Z2." },
    b: { name: "Crestview Realty Private Limited", context: "Residential development, Nagpur. GSTIN 27AADCC4456V1Z7." },
    id: "conflict", evidence: {}, truth: "separate" },

  // --- holding company vs. subsidiary: legitimately related, legitimately
  // distinct legal entities. Real work for the review path. ---
  { a: { name: "Ashford Holdings Ltd", context: "Diversified holding company, Mumbai. Domain ashfordgroup.in." },
    b: { name: "Ashford Consumer Products Pvt Ltd", context: "FMCG subsidiary of Ashford Holdings. Domain ashfordgroup.in." },
    id: "none", evidence: { sameDomain: true }, truth: "review" },

  { a: { name: "Marlow Group Ltd", context: "Parent holding entity, Bengaluru." },
    b: { name: "Marlow Fintech Services Pvt Ltd", context: "Wholly-owned fintech subsidiary of Marlow Group. Recurring settlement description." },
    id: "none", evidence: { recurringDescription: true }, truth: "review" },

  { a: { name: "Fernhill Enterprises Ltd", context: "Holding company for the Fernhill group of businesses." },
    b: { name: "Fernhill Hospitality Pvt Ltd", context: "Hotel subsidiary under Fernhill Enterprises. Domain fernhillgroup.in." },
    id: "none", evidence: { sameDomain: true }, truth: "review" },

  { a: { name: "Castleton Industries Ltd", context: "Industrial holding company, Ahmedabad." },
    b: { name: "Castleton Polymers Pvt Ltd", context: "Polymer manufacturing subsidiary of Castleton Industries. Recurring settlement description." },
    id: "none", evidence: { recurringDescription: true }, truth: "review" },

  { a: { name: "Windermere Capital Ltd", context: "Investment holding entity." },
    b: { name: "Windermere Renewables Pvt Ltd", context: "Solar power subsidiary of Windermere Capital. Domain windermerecap.in." },
    id: "none", evidence: { sameDomain: true }, truth: "review" },

  { a: { name: "Oakridge Ventures Ltd", context: "Parent venture holding company." },
    b: { name: "Oakridge Digital Services Pvt Ltd", context: "Technology subsidiary of Oakridge Ventures. Settlement description recurs each period." },
    id: "none", evidence: { recurringDescription: true }, truth: "review" },

  // --- transliteration and spelling variants: sometimes the same entity,
  // sometimes a coincidence. Neither answer should be assumed from the
  // spelling alone. ---
  { a: { name: "Shri Krishna Rice Mills", context: "Rice processing, Karnal. GSTIN 06AAGFS2201A1Z3." },
    b: { name: "Sri Krishna Rice Mills", context: "Rice processing and export, Karnal. GSTIN 06AAGFS2201A1Z3." },
    id: "match", evidence: {}, truth: "merge" },

  { a: { name: "Vajraa Auto Components Pvt Ltd", context: "Two-wheeler parts supplier, Pune." },
    b: { name: "Vajra Auto Components Private Limited", context: "Auto components manufacturer, Pune. Recurring settlement description." },
    id: "none", evidence: { recurringDescription: true }, truth: "review" },

  { a: { name: "Aluminium Extrusions of India Ltd", context: "Extruded aluminium profiles manufacturer." },
    b: { name: "Aluminum Extrusions of India Limited", context: "Aluminum profile manufacturer, same operations. Domain aeoi.in." },
    id: "none", evidence: { sameDomain: true }, truth: "review" },

  { a: { name: "Chhaya Weaving Mills Pvt Ltd", context: "Handloom textile weaving, Varanasi." },
    b: { name: "Chaya Weaving Mills Private Limited", context: "Handloom and power-loom weaving, Varanasi. Post-merger metadata notes a 2023 spelling correction." },
    id: "none", evidence: { postMerger: true }, truth: "review" },

  { a: { name: "Vishwakarma Engineering Works", context: "Heavy fabrication, Faridabad. GSTIN 06AAFFV7712C1Z8." },
    b: { name: "Vishvakarma Engineering Works", context: "Heavy fabrication and structural steel, Faridabad. GSTIN 06AAFFV7712C1Z8." },
    id: "match", evidence: {}, truth: "merge" },

  { a: { name: "Lakshmi Spinning Mills Ltd", context: "Cotton yarn spinning, Coimbatore." },
    b: { name: "Laxmi Spinning Mills Limited", context: "Synthetic yarn spinning, Salem. No relationship to the Coimbatore entity." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Ganapathy Textiles Pvt Ltd", context: "Power-loom textile unit, Erode." },
    b: { name: "Ganapati Textiles Private Limited", context: "Power-loom fabric weaving, Erode. Same settlement account referenced across periods." },
    id: "none", evidence: { recurringDescription: true }, truth: "review" },

  { a: { name: "Anandpur Steel Traders", context: "Steel re-rolling and trading, Ludhiana. GSTIN 03AAJFA6612D1Z5." },
    b: { name: "Anand Steel Traders", context: "Steel trading, unrelated entity, Amritsar. GSTIN 03AAJFA9987E1Z0." },
    id: "conflict", evidence: {}, truth: "separate" },

  // --- shared-prefix conglomerate names: same group prefix, genuinely
  // different legal entities. High lexical overlap by construction — the
  // trap a weak string matcher falls into. ---
  { a: { name: "Kaveri Steel Ltd", context: "Long steel products manufacturer, part of the Kaveri group." },
    b: { name: "Kaveri Motors Ltd", context: "Two-wheeler dealership network, part of the Kaveri group. Genuinely separate legal entity from Kaveri Steel." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Meghna Cements Ltd", context: "Cement manufacturing, part of the Meghna conglomerate." },
    b: { name: "Meghna Textiles Ltd", context: "Composite textile mill, part of the Meghna conglomerate. Distinct legal entity from Meghna Cements." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Parivartan Chemicals Ltd", context: "Specialty chemicals manufacturer, Parivartan group company." },
    b: { name: "Parivartan Fertilizers Ltd", context: "Fertilizer production, Parivartan group company. Separate legal entity from Parivartan Chemicals." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Udayan Power Ltd", context: "Thermal power generation, Udayan group." },
    b: { name: "Udayan Finance Ltd", context: "NBFC lending arm, Udayan group. Distinct legal entity from Udayan Power." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Trishul Pharma Ltd", context: "Generic pharmaceutical manufacturer, Trishul group." },
    b: { name: "Trishul Agro Ltd", context: "Agrochemical producer, Trishul group. Separate legal entity from Trishul Pharma." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Palani Motors Ltd", context: "Commercial vehicle assembly, Palani group." },
    b: { name: "Palani Realty Ltd", context: "Real estate development, Palani group. Distinct legal entity from Palani Motors." },
    id: "none", evidence: {}, truth: "separate" },

  // --- genuinely unrelated pairs with high lexical overlap: shared generic
  // words (industry terms, place names), no relationship at all. ---
  { a: { name: "National Cable Industries Ltd", context: "Electrical cable manufacturer, Nagpur." },
    b: { name: "National Cable Networks Pvt Ltd", context: "Cable television distribution, unrelated business, Hyderabad." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Star Diamond Exports Pvt Ltd", context: "Cut and polished diamond exporter, Surat." },
    b: { name: "Star Diamond Jewellers Ltd", context: "Retail jewellery chain, unrelated entity, Mumbai." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Ganga Paper Mills Ltd", context: "Kraft paper manufacturing, Saharanpur." },
    b: { name: "Ganga Paper Products Pvt Ltd", context: "Paper stationery converter, unrelated ownership, Meerut." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Unity Insurance Brokers Pvt Ltd", context: "Corporate insurance broking, Delhi." },
    b: { name: "Unity Housing Finance Ltd", context: "Home loan NBFC, unrelated entity, Noida." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Harvestway Seeds Pvt Ltd", context: "Hybrid seed producer, Hyderabad." },
    b: { name: "Harvestway Cement Industries Ltd", context: "Cement manufacturer, unrelated entity, Nalgonda." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Excel Plastics Pvt Ltd", context: "Injection-moulded plastic components, Rajkot." },
    b: { name: "Excel Software Systems Ltd", context: "IT services firm, unrelated entity, Rajkot." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Hillcrest Dairy Products Ltd", context: "Milk and dairy processing, Kolkata." },
    b: { name: "Hillcrest Auto Spares Pvt Ltd", context: "Automobile spare parts retailer, unrelated entity, Kolkata." },
    id: "none", evidence: {}, truth: "separate" },

  { a: { name: "Universal Tyres Ltd", context: "Automotive tyre manufacturer, Ballabhgarh." },
    b: { name: "Universal Traders and Agencies", context: "General trading house, unrelated entity, Ballabhgarh." },
    id: "none", evidence: {}, truth: "separate" },
];
