import { fuzzyScore, idCheck, gate, whyText, net, corroboratingFlags, ablationRoute, scoreAblation } from "./pipeline.js";
import { semanticScore, loadModel, isReady } from "./embed.js";
import { CASES, ENTITIES, OBLIGATIONS, ABLATION_CASES } from "./fixture.js";
import { createGraph } from "./graph.js";

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
    if (b.dataset.tab === "netting") showNetting();
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
// model load
// --------------------------------------------------------------------------
const dot = $("#dot");
const modelStatus = $("#modelstatus");
dot.className = "dot loading";
modelStatus.textContent = "loading on-device model…";
loadModel((p) => {
  if (p.status === "progress" && p.total) {
    modelStatus.textContent = `downloading model ${(p.loaded / 1e6).toFixed(1)} / ${(p.total / 1e6).toFixed(0)} MB`;
  }
}).then(() => {
  dot.className = "dot ready";
  modelStatus.textContent = "on-device model ready · no network calls for matching";
  $("#netCut").disabled = false;
  scoreAllCases();
}).catch((e) => {
  dot.className = "dot";
  modelStatus.textContent = "model failed to load, check console";
  console.error(e);
});
$("#netCut").onclick = () => setNetwork(!networkCut);

// --------------------------------------------------------------------------
// review queue
// --------------------------------------------------------------------------
const LABEL = { AUTO_MERGE: "Auto-merge", REVIEW_REQUIRED: "Review required", KEEP_SEPARATE: "Keep separate" };

function scoreSummary(s) {
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

async function scoreAllCases() {
  for (const c of CASES) {
    // Per-case guard: one failed embedding must not throw out of the loop and
    // leave the remaining cards stuck on "scoring locally…" with no way back.
    try {
      const fuzzy = fuzzyScore(c.source.name, c.candidate.name);
      const semantic = await semanticScore(c.source, c.candidate);
      const idStatus = idCheck(c.source.id, c.candidate.id);
      const result = gate({ semanticScore: semantic, idStatus, evidence: c.evidence });
      scored.set(c.id, { fuzzy, semantic, idStatus, result });
      console.log(`case ${c.id}: fuzzy=${fuzzy.toFixed(3)} semantic=${semantic.toFixed(3)} id=${idStatus} -> ${result.decision}`);
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
       <div class="scorepill"><span class="tag">AI confidence</span><b>${s.semantic.toFixed(2)}</b><em>model output</em></div>
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
  if (Math.abs(from - to) < 0.01) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 600);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setReadout(s, animate) {
  const num = (el, to, fmt) => {
    if (animate) countUp(el, to, fmt);
    else { el.dataset.n = to; el.textContent = fmt(to); }
  };
  num($("#mGross"), s.gross, fmtINR);
  num($("#mNet"), s.netSettlementVolume, fmtINR);
  num($("#mPct"), s.reductionPct, (v) => v.toFixed(1) + "%");
  $("#mLegs").textContent = `${s.legsBefore} → ${s.legsAfter}`;
  $("#mExcluded").textContent = String(s.excludedCount);
}

let graph = null;
function showNetting() {
  const s = currentState();
  if (!graph) graph = createGraph($("#nettingGraph"));
  graph.render(s, { animate: true });
  setReadout(s, true);
}
function refreshNettingNumbers() {
  setReadout(currentState(), $("#netting").classList.contains("active"));
}
setReadout(currentState(), false);

// --------------------------------------------------------------------------
// audit
// --------------------------------------------------------------------------
function renderAudit() {
  const el = $("#auditLog");
  $("#auditCount").textContent = String(auditLog.length);
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
       <div class="scorepill"><span class="tag">AI confidence</span><b>${s.semantic.toFixed(2)}</b><em>model output</em></div>
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
renderQueue();
renderAudit();
