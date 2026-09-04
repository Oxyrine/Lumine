import { fuzzyScore, idCheck, gate, whyText, net, corroboratingFlags } from "./pipeline.js";
import { semanticScore, loadModel, isReady } from "./embed.js";
import { CASES, ENTITIES, OBLIGATIONS } from "./fixture.js";
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
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("main section").forEach((s) => s.classList.toggle("active", s.id === b.dataset.tab));
    if (b.dataset.tab === "netting") showNetting();
  };
});

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
  scoreAllCases();
}).catch((e) => {
  dot.className = "dot";
  modelStatus.textContent = "model failed to load, check console";
  console.error(e);
});

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
    const fuzzy = fuzzyScore(c.source.name, c.candidate.name);
    const semantic = await semanticScore(c.source, c.candidate);
    const idStatus = idCheck(c.source.id, c.candidate.id);
    const result = gate({ semanticScore: semantic, idStatus, evidence: c.evidence });
    scored.set(c.id, { fuzzy, semantic, idStatus, result });
    console.log(`case ${c.id}: fuzzy=${fuzzy.toFixed(3)} semantic=${semantic.toFixed(3)} id=${idStatus} -> ${result.decision}`);
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
  stage("LOCAL EMBEDDING", `cosine similarity ${semantic.toFixed(3)}   (on-device)`);
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
renderQueue();
renderAudit();
