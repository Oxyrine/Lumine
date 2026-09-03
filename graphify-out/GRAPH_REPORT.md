# Graph Report - .  (2026-09-03)

## Corpus Check
- Corpus is ~4,950 words - fits in a single context window. You may not need a graph.

## Summary
- 85 nodes · 155 edges · 9 communities (7 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Documentation & Navigation UI
- Entity Resolution & Scoring Pipeline
- Application State & Case Lifecycle
- Pipeline Architecture & Model Specs
- UI Rendering & Detail Modal
- Workflow Approvals & Netting View
- On-Device Embedding & Cosine Similarity
- Debt & Obligation Netting
- Service Worker PWA Shell

## God Nodes (most connected - your core abstractions)
1. `Lumine` - 14 edges
2. `openDetail()` - 12 edges
3. `renderQueue()` - 9 edges
4. `scoreAllCases()` - 7 edges
5. `approve()` - 7 edges
6. `keepSeparate()` - 6 edges
7. `renderNetting()` - 6 edges
8. `Matching Pipeline` - 6 edges
9. `esc()` - 5 edges
10. `semanticScore()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Review Queue Section` --semantically_similar_to--> `Review Screen`  [INFERRED] [semantically similar]
  index.html → README.md
- `Live Form Section` --semantically_similar_to--> `Live Resolution Screen`  [INFERRED] [semantically similar]
  index.html → README.md
- `Netting Metrics Section` --semantically_similar_to--> `Netting Screen`  [INFERRED] [semantically similar]
  index.html → README.md
- `Audit Log Section` --semantically_similar_to--> `Audit Screen`  [INFERRED] [semantically similar]
  index.html → README.md
- `scoreAllCases()` --calls--> `semanticScore()`  [EXTRACTED]
  app.js → embed.js

## Import Cycles
- None detected.

## Communities (9 total, 2 thin omitted)

### Community 0 - "Documentation & Navigation UI"
Cohesion: 0.13
Nodes (19): App Module Script, Audit Log Section, Model Status Header, Live Form Section, Tab Navigation Bar, Netting Metrics Section, Review Queue Section, Service Worker Registration (+11 more)

### Community 1 - "Entity Resolution & Scoring Pipeline"
Cohesion: 0.18
Nodes (15): scoreAllCases(), CASES, ENTITIES, OBLIGATIONS, ALIASES, corroboratingFlags(), FLAG_LABELS, fuzzyScore() (+7 more)

### Community 2 - "Application State & Case Lifecycle"
Cohesion: 0.17
Nodes (9): auditLog, decidedSeparate, dot, LABEL, mapping, modelStatus, resolved, scored (+1 more)

### Community 3 - "Pipeline Architecture & Model Specs"
Cohesion: 0.20
Nodes (11): Authoritative ID Check, Deterministic Netting, embed.js, Governance Gate, GSTIN Identifier, Matching Pipeline, Xenova/all-MiniLM-L6-v2, Normalization Stage (+3 more)

### Community 4 - "UI Rendering & Detail Modal"
Cohesion: 0.52
Nodes (7): esc(), evLine(), html(), openDetail(), renderQueue(), scoreSummary(), setHTML()

### Community 5 - "Workflow Approvals & Netting View"
Cohesion: 0.47
Nodes (6): approve(), fmtINR(), keepSeparate(), nowIST(), renderAudit(), renderNetting()

### Community 6 - "On-Device Embedding & Cosine Similarity"
Cohesion: 0.53
Nodes (5): cosine(), embed(), isReady(), loadModel(), semanticScore()

## Knowledge Gaps
- **22 isolated node(s):** `resolved`, `mapping`, `auditLog`, `scored`, `decidedSeparate` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Lumine` connect `Documentation & Navigation UI` to `Pipeline Architecture & Model Specs`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `Matching Pipeline` connect `Pipeline Architecture & Model Specs` to `Documentation & Navigation UI`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `semanticScore()` connect `On-Device Embedding & Cosine Similarity` to `Entity Resolution & Scoring Pipeline`, `Application State & Case Lifecycle`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `resolved`, `mapping`, `auditLog` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Documentation & Navigation UI` be split into smaller, more focused modules?**
  _Cohesion score 0.13157894736842105 - nodes in this community are weakly interconnected._