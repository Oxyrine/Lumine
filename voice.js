// On-device voice authorization. Xenova/whisper-tiny.en via transformers.js —
// deliberately NOT the browser's native SpeechRecognition API, which is
// server-backed and would silently violate the "nothing leaves the device"
// claim the network-cut demonstration (app.js, spec §13) exists to prove.
// Loaded lazily on first mic use, never at boot: it's a second ~40 MB model
// alongside MiniLM, and most sessions never touch voice at all.

import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
export { matchIntent } from "./voice-grammar.js";

const MODEL = "Xenova/whisper-tiny.en";

let recognizer = null;
let loadPromise = null;

export function loadVoiceModel(onProgress) {
  if (recognizer) return Promise.resolve(recognizer);
  if (loadPromise) return loadPromise;
  loadPromise = pipeline("automatic-speech-recognition", MODEL, {
    dtype: "q8",
    progress_callback: onProgress,
  }).then((r) => { recognizer = r; return r; })
    .catch((err) => {
      // Same reset-on-failure pattern as embed.js's loadModel — one blocked
      // CDN load shouldn't permanently disable voice for the rest of the page.
      loadPromise = null;
      throw err;
    });
  return loadPromise;
}

export function isVoiceReady() {
  return recognizer != null;
}

// Records up to `maxMs` of mono mic audio, decodes it to the 16 kHz PCM
// Float32 buffer whisper expects (decodeAudioData resamples to the
// AudioContext's own rate, so creating the context at 16000 does the
// resampling for free), and transcribes it on-device.
export async function recordAndTranscribe(maxMs = 4000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    await new Promise((r) => setTimeout(r, maxMs));
    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: recorder.mimeType });
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const pcm = decoded.numberOfChannels > 1 ? mixToMono(decoded) : decoded.getChannelData(0);
    await audioCtx.close();

    const model = await loadVoiceModel();
    const out = await model(pcm);
    return (out.text || "").trim();
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function mixToMono(decoded) {
  const len = decoded.getChannelData(0).length;
  const out = new Float32Array(len);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += ch[i] / decoded.numberOfChannels;
  }
  return out;
}
