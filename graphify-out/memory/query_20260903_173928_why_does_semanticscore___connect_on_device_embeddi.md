---
type: "query"
date: "2026-09-03T17:39:28.922790+00:00"
question: "Why does semanticScore() connect On-Device Embedding & Cosine Similarity to Entity Resolution & Scoring Pipeline, Application State & Case Lifecycle?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["semanticScore()", "scoreAllCases()", "loadModel()", "embed()", "cosine()", "gate()", "scored", "resolved"]
---

# Q: Why does semanticScore() connect On-Device Embedding & Cosine Similarity to Entity Resolution & Scoring Pipeline, Application State & Case Lifecycle?

## Answer

Expanded from original query via vocab: [semantic, score, embed, cosine, pipeline, cases, scored]. In Lumine, semanticScore() in embed.js serves as the critical bridge between on-device ML embedding and deterministic entity resolution. scoreAllCases() in app.js calls semanticScore() to compute cosine similarity between counterparty representations using local MiniLM embeddings. This score is combined with idCheck() and fuzzyScore() from pipeline.js in gate() to make resolution decisions, which are committed to application state (scored, resolved, mapping, auditLog) governing UI queue rendering and netting.

## Outcome

- Signal: useful

## Source Nodes

- semanticScore()
- scoreAllCases()
- loadModel()
- embed()
- cosine()
- gate()
- scored
- resolved