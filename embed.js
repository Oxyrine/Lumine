// On-device embedding. transformers.js pulls a quantized MiniLM (~23 MB) and
// runs inference in the browser (WASM). No cloud matching API.
// After the first load the model files sit in the Cache API — matching then
// works with the network off.

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";

env.allowLocalModels = false; // model comes from the HF CDN, then browser cache

const MODEL = "Xenova/all-MiniLM-L6-v2";

let extractor = null;
let loadPromise = null;

// onProgress: ({ status, progress, file }) => void
export function loadModel(onProgress) {
  if (extractor) return Promise.resolve(extractor);
  if (loadPromise) return loadPromise;
  loadPromise = pipeline("feature-extraction", MODEL, {
    dtype: "q8",
    progress_callback: onProgress,
  }).then((e) => {
    extractor = e;
    return e;
  }).catch((err) => {
    // Clear the cached rejection so a later call can retry. Without this one
    // failed load (blocked CDN, dead venue wifi) permanently bricks matching
    // for the life of the page — every subsequent loadModel() would return
    // this same rejected promise and isReady() would never become true.
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

export function isReady() {
  return extractor != null;
}

async function embed(text) {
  const e = await loadModel();
  const out = await e(text, { pooling: "mean", normalize: true });
  return out.data; // Float32Array, already L2-normalized
}

export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // inputs are unit vectors
}

// Semantic similarity over "name — context" for each side (spec: names + description context).
export async function semanticScore(a, b) {
  const [va, vb] = await Promise.all([
    embed(`${a.name} — ${a.context || ""}`.trim()),
    embed(`${b.name} — ${b.context || ""}`.trim()),
  ]);
  return cosine(va, vb);
}
