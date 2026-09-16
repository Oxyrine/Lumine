// Fixed voice-authorization grammar — pure string matching, zero dependency.
// Split out of voice.js so it can be unit-tested in Node without pulling in
// the transformers.js CDN import (test.mjs stays model-free and network-free,
// same reason pipeline.js never imports embed.js or a DOM).

const GRAMMAR = [
  { intent: "approve", phrases: ["approve", "approve match", "confirm merge", "confirm", "yes approve"] },
  { intent: "separate", phrases: ["keep separate", "separate", "reject", "deny"] },
  { intent: "cancel", phrases: ["cancel", "never mind", "stop"] },
];

// Returns null (no match) rather than guessing; a misheard or unmatched
// utterance must never silently apply a decision.
export function matchIntent(transcript) {
  const t = String(transcript || "").toLowerCase().replace(/[.,!?]/g, "").trim();
  if (!t) return null;
  for (const { intent, phrases } of GRAMMAR) {
    if (phrases.some((p) => t === p || t.includes(p))) return intent;
  }
  return null;
}
