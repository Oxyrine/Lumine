import { fuzzyScore, idCheck, gate, whyText, net, corroboratingFlags, ablationRoute, scoreAblation } from "./pipeline.js";
import { semanticScore, loadModel, isReady } from "./embed.js";
import { CASES, ENTITIES, OBLIGATIONS, ABLATION_CASES } from "./fixture.js";
import { createGraph } from "./graph.js";
import { createScatter } from "./scatter.js";

// --------------------------------------------------------------------------
// state
// --------------------------------------------------------------------------
const resolved = new Set(ENTITIES);
const mapping = {};                 // approved counterparty id -> canonical entity
const auditLog = [];
const scored = new Map();           // case id -> { fuzzy, semantic, idStatus, result }
const decidedSeparate = new Set();
let mappingVersion = 0;
const demo = { on: false, step: 0 };

const $ = (s) => document.querySelector(s);
const fmtINR = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const nowIST = () =>
  new Date().toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Kolkata" }) + " IST";

// esc(): every dynamic value rendered into markup passes through this.
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// html``: interpolations are escaped by construction. Callers only ever pass
// a string built by this tag or a static literal into setHTML().
function html(strings, ...vals) {
  return strings.reduce((a, s, i) => a + s + (i < vals.length ? esc(vals[i]) : ""), "");
}
function setHTML(el, s) { el.innerHTML = s; }

// --------------------------------------------------------------------------
// tabs
// --------------------------------------------------------------------------
document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => {
    if (demo.on) exitDemo();
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("main section").forEach((s) => s.classList.toggle("active", s.id === b.dataset.tab));
    if (b.dataset.tab === "netting") { setReadout(currentState(), true); if (graphDirty) paintGraph({ animate: true }); }
  };
});
function goTab(name) {
  document.querySelector(`nav button[data-tab="${name}"]`).click();
}

// --------------------------------------------------------------------------
// offline demo — cut every network call, prove matching is local (spec §15)
// --------------------------------------------------------------------------
let networkCut = false;
const _fetch = window.fetch.bind(window);
window.fetch = (...a) => (networkCut ? Promise.reject(new Error("network cut for the offline demo")) : _fetch(...a));
const _XHR = window.XMLHttpRequest;
window.XMLHttpRequest = function () {
  const x = new _XHR();
  const open = x.open.bind(x);
  x.open = (...a) => { if (networkCut) throw new Error("network cut for the offline demo"); return open(...a); };
  return x;
};

function setNetwork(cut) {
  networkCut = cut;
  const btn = $("#netCut");
  btn.textContent = cut ? "Network cut — restore" : "Cut the network";
  btn.classList.toggle("cut", cut);
  $("#dot").className = cut ? "dot cut" : "dot ready";
  modelStatus.textContent = cut
    ? "network cut · matching runs entirely on this device"
    : "on-device model ready · no network calls for matching";
}

// --------------------------------------------------------------------------
// model load — the cold open
// --------------------------------------------------------------------------
const dot = $("#dot");
const modelStatus = $("#modelstatus");
const boot = $("#boot");
const bootStatus = $("#bootStatus");
const bootBar = $("#bootBar");
const bootActions = $("#bootActions");
const BOOT_MIN = 450;              // flash-of-content floor — NOT a fabricated delay
const bootT0 = performance.now();
let bootDismissed = false;
let sawProgress = false;

function dismissBoot() {
  if (bootDismissed) return;
  bootDismissed = true;
  const wait = boot ? Math.max(0, BOOT_MIN - (performance.now() - bootT0)) : 0;
  setTimeout(() => {
    if (boot) {
      boot.classList.add("gone");
      setTimeout(() => boot.remove(), 420);
    }
    // The first graph render happens HERE, not at module load: on desktop the
    // companion is visible behind the overlay, so an earlier render would play
    // the spawn-in unseen.
    paintGraph({ animate: true });
    const phone = $("#phone");
    if (phone && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      phone.animate(
        [{ transform: "translateY(10px)", opacity: 0.5 }, { transform: "none", opacity: 1 }],
        { duration: 460, easing: "cubic-bezier(0.22,1,0.36,1)" }
      );
    }
  }, wait);
}

function bootProgress(p) {
  if (p.status === "progress" && p.total) {
    sawProgress = true;
    if (bootBar) { bootBar.hidden = false; bootBar.firstElementChild.style.transform = `scaleX(${(p.loaded / p.total).toFixed(3)})`; }
    const line = `downloading the model to this device — ${(p.loaded / 1e6).toFixed(1)} of ${(p.total / 1e6).toFixed(0)} MB`;
    if (bootStatus) bootStatus.textContent = line;
    modelStatus.textContent = `downloading model ${(p.loaded / 1e6).toFixed(1)} / ${(p.total / 1e6).toFixed(0)} MB`;
  }
}

function bootFail(err) {
  console.error(err);
  dot.className = "dot";
  modelStatus.textContent = "model failed to load, check console";
  if (!boot) return;
  bootStatus.textContent = "the model could not be downloaded";
  bootBar.hidden = true;
  setHTML(bootActions, "");
  const retry = document.createElement("button");
  retry.className = "primary";
  retry.textContent = "Retry";
  retry.disabled = networkCut;   // the network-cut monkeypatch would fail the fetch
  retry.title = networkCut ? "restore the network first" : "";
  retry.onclick = () => { setHTML(bootActions, ""); bootStatus.textContent = "retrying"; startModel(); };
  const skip = document.createElement("button");
  skip.textContent = "Continue without the model";
  skip.onclick = dismissBoot;
  bootActions.append(retry, skip);
}

// If the download is genuinely slow, let people move on. The model keeps
// loading; scoreAllCases still fires on resolve.
let skipTimer = setTimeout(() => {
  if (bootDismissed || isReady() || !bootActions) return;
  const skip = document.createElement("button");
  skip.textContent = "Skip — explore the interface";
  skip.onclick = dismissBoot;
  bootActions.append(skip);
}, 6000);

function startModel() {
  dot.className = "dot loading";
  modelStatus.textContent = "loading on-device model…";
  loadModel(bootProgress).then(() => {
    clearTimeout(skipTimer);
    dot.className = "dot ready";
    modelStatus.textContent = "on-device model ready · no network calls for matching";
    $("#netCut").disabled = false;
    if (bootStatus) bootStatus.textContent = sawProgress ? "model ready · matching runs on this device" : "model already on this device";
    dismissBoot();
    scoreAllCases();
  }).catch(bootFail);
}
startModel();
$("#netCut").onclick = () => setNetwork(!networkCut);

// --------------------------------------------------------------------------
// review queue
// --------------------------------------------------------------------------
const LABEL = { AUTO_MERGE: "Auto-merge", REVIEW_REQUIRED: "Review required", KEEP_SEPARATE: "Keep separate" };

function scoreSummary(s) {
  if (s.semantic == null) return `fuzzy ${s.fuzzy.toFixed(2)} · ID ${s.idStatus} — the identifier decided this`;
  return `fuzzy ${s.fuzzy.toFixed(2)} · semantic ${s.semantic.toFixed(2)} · ID ${s.idStatus}`;
}

function renderQueue() {
  const q = $("#queue");
  const open = CASES.filter((c) => !mapping[c.counterpartyId] && !decidedSeparate.has(c.id));
  $("#pendingCount").textContent = open.length;
  if (open.length === 0) {
    setHTML(q, '<div class="empty">All matches resolved. See the netting run and audit log.</div>');
    return;
  }
  q.replaceChildren();
  open.forEach((c, i) => {
    const s = scored.get(c.id);
    const card = document.createElement("div");
    card.className = "card tap reveal";
    card.style.setProperty("--i", i);
    setHTML(card,
      html`<div class="pair">${c.source.name}<span class="arrow">↔</span>${c.candidate.name}</div>
           <div class="sub">${s ? scoreSummary(s) : "scoring locally…"}</div>` +
      `<span class="badge ${s ? s.result.decision : "pending"}">${s ? esc(LABEL[s.result.decision]) : "pending"}</span>`
    );
    if (s) card.onclick = () => openDetail(c);
    q.appendChild(card);
  });
}

// The cases the identifier decides need no model — score them synchronously at
// load so two of the three cards carry a real decision within milliseconds,
// and the queue still works if the model never loads at all.
function scoreIdCases() {
  for (const c of CASES) {
    if (scored.has(c.id)) continue;
    const idStatus = idCheck(c.source.id, c.candidate.id);
    if (idStatus === "absent") continue; // this one genuinely needs the embedding
    const fuzzy = fuzzyScore(c.source.name, c.candidate.name);
    const result = gate({ semanticScore: null, idStatus, evidence: c.evidence });
    scored.set(c.id, { fuzzy, semantic: null, idStatus, result });
  }
  renderQueue();
}

async function scoreAllCases() {
  for (const c of CASES) {
    if (scored.has(c.id)) continue;
    // Per-case guard: one failed embedding must not throw out of the loop and
    // leave the remaining cards stuck on "scoring locally…" with no way back.
    try {
      const fuzzy = fuzzyScore(c.source.name, c.candidate.name);
      const idStatus = idCheck(c.source.id, c.candidate.id);
      // gate() ignores semanticScore when the ID is decisive — only pay for the
      // embedding when the decision actually turns on it.
      const semantic = idStatus === "absent" ? await semanticScore(c.source, c.candidate) : null;
      const result = gate({ semanticScore: semantic, idStatus, evidence: c.evidence });
      scored.set(c.id, { fuzzy, semantic, idStatus, result });
      renderQueue(); // paint each card as it lands, not all at the end
    } catch (e) {
      console.error(`case ${c.id} scoring failed`, e);
    }
  }
  renderQueue();
}

function evLine(ok, text) {
  return `<li><span class="${ok ? "y" : "n"}">${ok ? "✓" : "✗"}</span> ${esc(text)}</li>`;
}

function openDetail(c) {
  const s = scored.get(c.id);
  const q = $("#queue");
  const before = currentNet();
  const trial = net(OBLIGATIONS, { ...mapping, [c.counterpartyId]: c.canonicalEntity }, resolved);
  const dVol = before.netSettlementVolume - trial.netSettlementVolume;
  const dLegs = before.legsAfter - trial.legsAfter;
  const why = whyText({ fuzzy: s.fuzzy, semanticScore: s.semantic, idStatus: s.idStatus, evidence: c.evidence });
  const idText = s.idStatus === "match" ? "Authoritative identifier matches"
    : s.idStatus === "conflict" ? "Authoritative ID: CONFLICT"
    : "No authoritative identifier on file";

  setHTML(q,
    `<div class="card">` +
    html`<div class="pair">${c.source.name}<span class="arrow">→</span>${c.candidate.name}</div>` +
    `<div class="scoreline">
       <div class="scorepill"><span class="tag">AI confidence</span><b>${s.semantic == null ? "not used" : s.semantic.toFixed(2)}</b><em>${s.semantic == null ? "the identifier decided this" : "model output"}</em></div>
       <div class="scorepill"><span class="tag">Gate decision</span><b>${esc(LABEL[s.result.decision])}</b><em>deterministic rule</em></div>
     </div>
     <ul class="evidence">
       ${evLine(c.evidence.sameDomain, "Same corporate domain")}
       ${evLine(c.evidence.postMerger, "Post-merger relationship in metadata")}
       ${evLine(c.evidence.recurringDescription, "Recurring settlement description")}
       ${evLine(s.idStatus === "match", idText)}
     </ul>` +
    html`<div class="why">${why}</div>` +
    `<div class="impact">
       <div><span class="k">Draft settlement volume</span><span>${dVol >= 0 ? "−" : "+"}${esc(fmtINR(Math.abs(dVol)))}</span></div>
       <div><span class="k">Payment legs</span><span>${dLegs > 0 ? "−" + dLegs : String(dLegs)}</span></div>
       <div><span class="k">Settlement instruction sent</span><span>none</span></div>
     </div>
     <div class="actions">
       <button class="btn-separate ${s.result.decision === "KEEP_SEPARATE" ? "primary" : ""}" id="dSep">Keep separate</button>
       <button class="btn-approve ${s.result.decision === "KEEP_SEPARATE" ? "" : "primary"}" id="dApp">${s.result.decision === "AUTO_MERGE" ? "Confirm merge" : "Approve match"}</button>
     </div>` +
    html`<div class="sub" style="margin-top:10px">${s.result.reason}</div>` +
    `</div>
     <button class="runbtn ghost" id="backBtn">Back to queue</button>`
  );
  $("#backBtn").onclick = renderQueue;
  $("#dApp").onclick = () => approve(c, s);
  $("#dSep").onclick = () => keepSeparate(c, s);
}

function approve(c, s) {
  mappingVersion += 1;
  mapping[c.counterpartyId] = c.canonicalEntity;
  const flags = corroboratingFlags(c.evidence);
  auditLog.unshift(
    `Match #${c.id} approved by Analyst A at ${nowIST()}\n` +
    `Evidence: semantic ${s.semantic.toFixed(2)}, ${flags.length ? flags.join(", ") : "no corroborating context"}, ID ${s.idStatus}\n` +
    `Result: mapping frozen (v${mappingVersion}) for netting run #2026-09-13-A`
  );
  renderAudit(); renderQueue(); refreshNettingNumbers();
}

function keepSeparate(c, s) {
  decidedSeparate.add(c.id);
  auditLog.unshift(
    `Match #${c.id} kept separate by Analyst A at ${nowIST()}\n` +
    `Reason: ${s.result.reason}\n` +
    `Result: obligation excluded from netting run #2026-09-13-A`
  );
  renderAudit(); renderQueue(); refreshNettingNumbers();
}

// --------------------------------------------------------------------------
// netting
// --------------------------------------------------------------------------
function currentNet() { return net(OBLIGATIONS, mapping, resolved); }
function currentState() { return { ...currentNet(), mapping: { ...mapping } }; }

function countUp(el, to, fmt) {
  const from = el.dataset.n == null ? to : Number(el.dataset.n);
  el.dataset.n = to;
  // Commit the final value on any path where the tween can't be seen — reduced
  // motion, a hidden document (rAF never fires), or no actual change. Without
  // this the number could stay frozen at a stale value: the tween writes the
  // text, but dataset.n was already advanced, so a later render just snaps.
  const canAnimate =
    !matchMedia("(prefers-reduced-motion: reduce)").matches &&
    document.visibilityState === "visible" &&
    Math.abs(from - to) >= 0.01;
  if (!canAnimate) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 600);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(k < 1 ? from + (to - from) * e : to);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// The numeric readout is a pure projection of state, so it renders into every
// host that carries the matching [data-stat] — the phone and, on desktop, the
// companion panel. countUp keeps per-element dataset.n, so two hosts animate
// independently and correctly.
function setReadout(s, animate) {
  const num = (key, to, fmt) =>
    document.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => {
      if (animate) countUp(el, to, fmt);
      else { el.dataset.n = to; el.textContent = fmt(to); }
    });
  num("gross", s.gross, fmtINR);
  num("net", s.netSettlementVolume, fmtINR);
  num("pct", s.reductionPct, (v) => v.toFixed(1) + "%");
  document.querySelectorAll('[data-stat="legs"]').forEach((el) => { el.textContent = `${s.legsBefore} → ${s.legsAfter}`; });
  document.querySelectorAll('[data-stat="excluded"]').forEach((el) => { el.textContent = String(s.excludedCount); });
}

// --- the graph: one instance, moved between slots, never re-created ----------
// createGraph() calls container.replaceChildren() and has no destroy path; its
// <marker id="arrow"> is a document-global id. So it must exist exactly once.
// appendChild relocates the node (svg, listeners, internal Maps all survive)
// rather than rebuilding it.
const graphHost = $("#graphHost");
const graph = createGraph(graphHost);
const wide = matchMedia("(min-width: 900px)");

function placeGraph() {
  const slot = wide.matches ? $("#graphSlotDesktop") : $("#graphSlotMobile");
  if (graphHost.parentElement !== slot) slot.appendChild(graphHost);
}

const visible = (el) => (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);

// R1/R2 from the plan: never render the graph while it is not visible. It diffs
// against its own previous state, so a hidden render would consume the delta
// and the later animated render would have nothing left to play. Mark dirty
// and replay on reveal instead.
let graphDirty = true;
function paintGraph(opts = {}) {
  if (!visible(graphHost)) { graphDirty = true; return; }
  graph.render(currentState(), { animate: opts.animate ?? true });
  graphDirty = false;
}

placeGraph();
wide.addEventListener("change", () => { placeGraph(); paintGraph({ animate: false }); });

function refreshNettingNumbers() {
  setReadout(currentState(), true);
  paintGraph({ animate: true }); // guards visibility itself; dirty if hidden
}

setReadout(currentState(), false);
// The first graph render is owned by dismissBoot() so its spawn-in isn't spent
// behind the cold-open overlay. With no overlay (rollback), render now instead.
if (!boot) requestAnimationFrame(() => paintGraph({ animate: true }));

// --------------------------------------------------------------------------
// audit
// --------------------------------------------------------------------------
function renderAudit() {
  $("#auditCount").textContent = String(auditLog.length);
  document.querySelectorAll('[data-host="audit"]').forEach((el) => {
    if (auditLog.length === 0) {
      setHTML(el, '<div class="empty">No decisions recorded yet.</div>');
      return;
    }
    el.replaceChildren();
    for (const line of auditLog) {
      const d = document.createElement("div");
      d.textContent = line;      // audit lines rendered as text, never markup
      el.appendChild(d);
    }
  });
}

// --------------------------------------------------------------------------
// live pipeline
// --------------------------------------------------------------------------
const STAGE_NAMES = ["INPUT", "NORMALIZATION", "LOCAL EMBEDDING", "TOP CANDIDATES", "EVIDENCE", "GOVERNANCE DECISION"];

function idField(v) {
  v = (v || "").trim();
  return v ? { type: "GSTIN", value: v } : null;
}
function normPreview(name) {
  return name.toLowerCase().replace(/[.,]/g, "").replace(/\bpvt\b/g, "private").replace(/\bltd\b/g, "limited").trim();
}

$("#runLive").onclick = async () => {
  const a = { name: $("#aName").value.trim(), context: $("#aCtx").value.trim(), id: idField($("#aId").value) };
  const b = { name: $("#bName").value.trim(), context: $("#bCtx").value.trim(), id: idField($("#bId").value) };
  if (!a.name || !b.name) { alert("Enter both counterparty names."); return; }
  const evidence = {
    sameDomain: $("#evDomain").checked,
    postMerger: $("#evMerger").checked,
    recurringDescription: $("#evRecurring").checked,
  };

  const box = $("#liveStages");
  box.hidden = false;
  setHTML(box, STAGE_NAMES.map((n) =>
    `<div class="stage" data-s="${n}"><div><div class="name">${n}</div><div class="val"></div></div></div>`
  ).join(""));

  const stage = (name, text, markup) => {
    const el = box.querySelector(`[data-s="${name}"]`);
    el.classList.add("on");
    const v = el.querySelector(".val");
    if (markup) setHTML(v, markup); else v.textContent = text;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  stage("INPUT", `${a.name}   vs   ${b.name}`);
  await wait(260);
  stage("NORMALIZATION", `"${normPreview(a.name)}"    "${normPreview(b.name)}"`);
  await wait(260);

  if (!isReady()) stage("LOCAL EMBEDDING", "loading model…");
  const semantic = await semanticScore(a, b);
  const fuzzy = fuzzyScore(a.name, b.name);
  stage("LOCAL EMBEDDING", `cosine similarity ${semantic.toFixed(3)}   (${networkCut ? "network cut · on-device" : "on-device"})`);
  await wait(260);

  stage("TOP CANDIDATES", `1 pair · fuzzy ${fuzzy.toFixed(2)} · semantic ${semantic.toFixed(2)}`);
  await wait(260);

  const idStatus = idCheck(a.id, b.id);
  const flags = corroboratingFlags(evidence);
  stage("EVIDENCE", `ID ${idStatus} · ${flags.length ? flags.join(", ") : "no corroborating flags"}`);
  await wait(260);

  const result = gate({ semanticScore: semantic, idStatus, evidence });
  stage("GOVERNANCE DECISION", null,
    `<span class="badge ${result.decision}">${esc(LABEL[result.decision])}</span>` +
    html`<div class="why">${result.reason}</div>`
  );
};

// --------------------------------------------------------------------------
// guided demo — the three cases as one narrated sequence (spec §9)
// --------------------------------------------------------------------------
const DEMO_STEPS = [
  { intro: true },
  { caseId: 1, line: "The authoritative identifier matches exactly. Deterministic evidence is enough — Lumine resolves this automatically, no model needed." },
  { caseId: 2, line: "The names barely overlap. The model finds a plausible relationship from the settlement context, but it cannot authorize a merge. Lumine routes it to you.", act: "approve" },
  { caseId: 3, line: "Here the model is confident. But the authoritative identifiers conflict. Confidence does not override evidence — Lumine refuses to merge.", act: "separate" },
  { outro: true },
];

function startDemo() {
  demo.on = true;
  demo.step = 0;
  goTab("review");
  renderDemoStep();
}
function exitDemo() {
  demo.on = false;
  renderQueue();
}
function renderDemoStep() {
  const q = $("#queue");
  const st = DEMO_STEPS[demo.step];
  const nav = (label, fn, primary) =>
    `<button class="runbtn ${primary ? "" : "ghost"}" id="demoNav">${esc(label)}${primary ? '<span class="ib" aria-hidden="true">&rarr;</span>' : ""}</button>`;

  if (st.intro) {
    setHTML(q,
      `<div class="card demo-card">` +
      `<div class="demo-kicker">Guided walkthrough</div>` +
      `<div class="pair" style="margin-bottom:10px">Three matches, three outcomes</div>` +
      html`<div class="demo-line">Watch the governance gate decide each case: one it resolves on its own, one it hands to you, one it refuses. AI proposes, evidence corroborates, you authorize.</div>` +
      `</div>` +
      nav("Start", null, true)
    );
    $("#demoNav").onclick = demoNext;
    return;
  }
  if (st.outro) {
    const r = currentNet();
    setHTML(q,
      `<div class="card demo-card">` +
      `<div class="demo-kicker">Walkthrough complete</div>` +
      `<div class="pair" style="margin-bottom:10px">1 auto-merged · 1 approved · 1 refused</div>` +
      html`<div class="demo-line">Only the corroborated and approved identities entered the netting run. The refused match is excluded. Draft settlement volume is now ${fmtINR(r.netSettlementVolume)} against ${fmtINR(r.gross)} gross.</div>` +
      `</div>` +
      `<button class="runbtn" id="demoNet">See the netting run<span class="ib" aria-hidden="true">&rarr;</span></button>` +
      `<button class="runbtn ghost" id="demoNav" style="margin-top:10px">Exit walkthrough</button>`
    );
    $("#demoNet").onclick = () => { exitDemo(); goTab("netting"); };
    $("#demoNav").onclick = exitDemo;
    return;
  }

  const c = CASES.find((x) => x.id === st.caseId);
  const s = scored.get(c.id);
  const badge = `<span class="badge ${s.result.decision}">${esc(LABEL[s.result.decision])}</span>`;
  setHTML(q,
    `<div class="card demo-card">` +
    `<div class="demo-kicker">Case ${st.caseId} of 3</div>` +
    html`<div class="pair">${c.source.name}<span class="arrow">→</span>${c.candidate.name}</div>` +
    `<div class="scoreline" style="margin-top:14px">
       <div class="scorepill"><span class="tag">AI confidence</span><b>${s.semantic == null ? "not used" : s.semantic.toFixed(2)}</b><em>${s.semantic == null ? "identifier decided" : "model output"}</em></div>
       <div class="scorepill"><span class="tag">ID check</span><b>${esc(s.idStatus)}</b><em>authoritative</em></div>
     </div>` +
    `<div style="margin:14px 0">${badge}</div>` +
    html`<div class="demo-line">${st.line}</div>` +
    `</div>` +
    nav(demo.step === DEMO_STEPS.length - 2 ? "Finish" : "Next case", null, true)
  );
  $("#demoNav").onclick = demoNext;
}
function demoNext() {
  const prev = DEMO_STEPS[demo.step];
  if (prev && prev.caseId) {
    const c = CASES.find((x) => x.id === prev.caseId);
    const s = scored.get(c.id);
    if (prev.act === "approve" && !mapping[c.counterpartyId]) approve(c, s);
    if (prev.act === "separate" && !decidedSeparate.has(c.id)) keepSeparate(c, s);
  }
  demo.step += 1;
  renderDemoStep();
}

// --------------------------------------------------------------------------
// ablation — does the embedding layer earn its place? (spec §12)
// --------------------------------------------------------------------------
let ablationRun = false;
async function runAblation() {
  const out = $("#ablationBody");
  setHTML(out, `<div class="empty">Running ${ABLATION_CASES.length} labelled pairs on-device…</div>`);
  const rows = [];
  for (const t of ABLATION_CASES) {
    const fuzzy = fuzzyScore(t.a.name, t.b.name);
    const semantic = await semanticScore(t.a, t.b);
    const idStatus = t.id === "match" ? "match" : t.id === "conflict" ? "conflict" : "absent";
    const base = { fuzzy, semantic, idStatus, evidence: t.evidence };
    rows.push({
      truth: t.truth,
      a: t.a.name, b: t.b.name,
      fuzzy, semantic,
      fuzzyOnly: ablationRoute({ ...base, useEmbedding: false }),
      full: ablationRoute({ ...base, useEmbedding: true }),
    });
  }
  const r = scoreAblation(rows);
  ablationRun = true;

  const cell = (n, danger) => `<td class="${danger && n > 0 ? "bad" : n === 0 ? "ok" : ""}">${n}</td>`;
  const pct = (x) => Math.round(x * 100) + "%";
  setHTML(out,
    `<div id="ablationPlot"></div>` +
    `<table class="abl">
      <tr><th></th><th>Fuzzy only</th><th>Fuzzy + embedding</th></tr>
      <tr><td>False merges</td>${cell(r.fuzzyOnly.falseMerge, true)}${cell(r.full.falseMerge, true)}</tr>
      <tr><td>False separations</td>${cell(r.fuzzyOnly.falseSep, true)}${cell(r.full.falseSep, true)}</tr>
      <tr><td>Review-routing recall</td><td>${pct(r.fuzzyOnly.reviewRecall)}</td><td>${pct(r.full.reviewRecall)}</td></tr>
    </table>` +
    html`<p class="abl-note">${ablationNote(r)}</p>` +
    (r.recovered.length
      ? `<div class="abl-rec"><div class="demo-kicker">Recovered by the embedding layer</div><ul>` +
        r.recovered.map((x) => html`<li>${x.a} &harr; ${x.b}</li>`).join("") + `</ul></div>`
      : "")
  );
  // Plot on top of the table: the picture makes the argument, the table proves it.
  createScatter($("#ablationPlot")).render(rows);
}
function ablationNote(r) {
  const merges = r.fuzzyOnly.falseMerge === 0 && r.full.falseMerge === 0;
  const n = r.recovered.length;
  if (merges && n > 0) {
    return `Both configurations produce zero false merges. The embedding layer recovers ${n} true relationship${n === 1 ? "" : "s"} that fuzzy matching alone routes to keep-separate — brand-versus-legal-name and post-merger renames with almost no string overlap.`;
  }
  if (merges) {
    return `Both configurations produce zero false merges. On this held-out set the embedding layer did not recover additional relationships beyond fuzzy matching; the string-similarity threshold already covers the easy cases.`;
  }
  return `Result recorded as computed. The false-merge count is the safety metric to watch.`;
}

// --------------------------------------------------------------------------
$("#runDemo").onclick = startDemo;
$("#runAblation").onclick = runAblation;
scoreIdCases();   // ID-decided cases land now, before the model finishes
renderAudit();

// No cold-open overlay (rollback): nothing lifts it, so score everything and
// dismiss immediately.
if (!boot) { dismissBoot(); }
