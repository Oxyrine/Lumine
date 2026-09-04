// Live entity-relationship graph for the netting run.
// Entities sit on a ring; unresolved counterparties float below until an
// approved mapping pulls them in. Renders SVG, animates between states.

import { ENTITIES, NODE_LABELS, UNRESOLVED } from "./fixture.js";

const NS = "http://www.w3.org/2000/svg";
const VB = { w: 360, h: 374 };
const RING = { cx: 180, cy: 134, r: 86 };
const FLOAT_Y = 330;
const NODE_R = 22;

const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// Fixed layout positions, computed once.
const LAYOUT = (() => {
  const pos = {};
  ENTITIES.forEach((id, i) => {
    const a = (-90 + i * (360 / ENTITIES.length)) * (Math.PI / 180);
    pos[id] = { x: RING.cx + RING.r * Math.cos(a), y: RING.cy + RING.r * Math.sin(a) };
  });
  UNRESOLVED.forEach((id, i) => {
    const span = VB.w - 100;
    pos[id] = { x: 50 + (span * (i + 0.5)) / UNRESOLVED.length, y: FLOAT_Y };
  });
  return pos;
})();

const lakh = (n) => {
  const v = n / 1e5;
  const s = v >= 0 ? "+" : "−";
  return `${s}${Math.abs(v).toFixed(1)}L`;
};
const edgeWidth = (amt) => Math.max(1.5, Math.min(3.6, amt / 340000));

// Arc between two points that bows AWAY from the ring centre, so edges hug the
// perimeter instead of crossing through the middle. `extra` nudges parallel
// edges (same node pair) apart.
function arc(a, b, extra = 0) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy) || 1;
  // perpendicular unit vector
  let px = -dy / chord;
  let py = dx / chord;
  // point it away from the ring centre
  if (px * (mx - RING.cx) + py * (my - RING.cy) < 0) { px = -px; py = -py; }
  const bow = Math.min(34, 0.24 * chord) + extra;
  return `M ${a.x} ${a.y} Q ${mx + px * bow} ${my + py * bow} ${b.x} ${b.y}`;
}

// Trim an endpoint back toward the other node by r, so arrowheads sit on the rim.
function trim(p, toward, r) {
  const dx = toward.x - p.x;
  const dy = toward.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / len) * r, y: p.y + (dy / len) * r };
}

function tween(setter, from, to, dur) {
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
    setter(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function createGraph(container) {
  container.replaceChildren();
  const svg = el("svg", { viewBox: `0 0 ${VB.w} ${VB.h}`, class: "netgraph" });

  const defs = el("defs");
  const marker = el("marker", {
    id: "arrow", viewBox: "0 0 8 8", refX: "6.5", refY: "4",
    markerWidth: "7", markerHeight: "7", markerUnits: "userSpaceOnUse", orient: "auto",
  });
  marker.append(el("path", { d: "M0 0.5 L8 4 L0 7.5 z", fill: "#8a94a4" }));
  defs.append(marker);

  const gEdges = el("g", { class: "edges" });
  const gNodes = el("g", { class: "nodes" });
  svg.append(defs, gEdges, gNodes);
  container.append(svg);

  const caption = document.createElement("div");
  caption.className = "graph-caption";
  caption.textContent = "Tap a node for its net position.";
  container.append(caption);

  const nodeEls = new Map(); // id -> { g, circle, valText }
  let prevMappingKeys = new Set();
  let lastEdgeKey = "";
  let firstPaint = true;
  let lastPositions = {};

  function nodePos(id, mapping) {
    const canon = mapping[id] ?? id;
    return LAYOUT[canon] || LAYOUT[id];
  }

  function ensureNode(id) {
    if (nodeEls.has(id)) return nodeEls.get(id);
    const p = LAYOUT[id];
    const g = el("g", { class: "node", transform: `translate(${p.x} ${p.y})`, tabindex: "0" });
    const circle = el("circle", { r: 0, class: "ncircle" });
    const valText = el("text", { class: "nval", "text-anchor": "middle", dy: "0.35em" });
    // label sits just outside the node, pushed radially away from the ring
    // centre so it clears the arcs that hug the perimeter
    const p0 = LAYOUT[id];
    let lx = 0, ly = NODE_R + 15;
    if (ENTITIES.includes(id)) {
      const dx = p0.x - RING.cx, dy = p0.y - RING.cy;
      const d = Math.hypot(dx, dy) || 1;
      lx = (dx / d) * (NODE_R + 13);
      ly = (dy / d) * (NODE_R + 13) + 3;
    }
    const label = el("text", { class: "nlabel", "text-anchor": "middle", x: lx, y: ly });
    label.textContent = NODE_LABELS[id] || id;
    g.append(circle, valText, label);
    g.addEventListener("click", () => {
      const pos = lastPositions[id];
      caption.textContent =
        pos == null
          ? `${NODE_LABELS[id] || id}: not in the netting run (identity unresolved)`
          : `${NODE_LABELS[id] || id}: net position ${lakh(pos)}  (${pos >= 0 ? "net receiver" : "net payer"})`;
    });
    gNodes.append(g);
    const rec = { g, circle, valText };
    nodeEls.set(id, rec);
    return rec;
  }

  function render(state, { animate = true } = {}) {
    const { positions, edges, excludedEdges, mapping } = state;
    lastPositions = positions;
    const mappingKeys = new Set(Object.keys(mapping));
    const newlyMerged = [...mappingKeys].filter((k) => !prevMappingKeys.has(k));
    const active = [...ENTITIES, ...UNRESOLVED];

    // ---- nodes ----
    active.forEach((id, i) => {
      const rec = ensureNode(id);
      const merged = mapping[id] && mapping[id] !== id;
      const target = nodePos(id, mapping);
      const val = merged ? null : positions[id];
      const inRun = val != null;

      const dur = animate ? 700 : 0;
      rec.g.style.transition = `transform ${dur}ms cubic-bezier(0.32,0.72,0,1), opacity ${dur}ms ease`;
      rec.g.setAttribute("transform", `translate(${target.x} ${target.y})`);

      if (merged) {
        rec.g.style.opacity = "0";
        rec.circle.style.transition = `r ${dur}ms cubic-bezier(0.32,0.72,0,1)`;
        rec.circle.setAttribute("r", "0");
        return;
      }

      rec.g.style.opacity = inRun ? "1" : "0.4";
      rec.g.classList.toggle("unresolved", !inRun);
      rec.circle.classList.toggle("recv", inRun && val >= 0);
      rec.circle.classList.toggle("payer", inRun && val < 0);

      const targetR = NODE_R;
      if (firstPaint && animate) {
        rec.circle.setAttribute("r", "0");
        setTimeout(() => {
          rec.circle.style.transition = "r 420ms cubic-bezier(0.32,0.72,0,1)";
          rec.circle.setAttribute("r", targetR);
        }, 70 * i);
      } else {
        rec.circle.setAttribute("r", targetR);
      }

      if (!inRun) {
        rec.valText.textContent = "?";
        rec.valText.dataset.v = "";
      } else {
        const prevV = rec.valText.dataset.v === "" || rec.valText.dataset.v == null
          ? val / 1e5
          : parseFloat(rec.valText.dataset.v);
        if (animate && !firstPaint && Math.abs(prevV - val / 1e5) > 0.05) {
          tween((v) => {
            rec.valText.dataset.v = v;
            rec.valText.textContent = lakh(v * 1e5);
          }, prevV, val / 1e5, 650);
          rec.g.classList.remove("pulse");
          requestAnimationFrame(() => rec.g.classList.add("pulse"));
        } else {
          rec.valText.dataset.v = val / 1e5;
          rec.valText.textContent = lakh(val);
        }
      }
    });

    // ---- edges ----
    const all = [
      ...edges.map((e) => ({ ...e, kind: "in" })),
      ...excludedEdges.map((e) => ({ ...e, kind: "ex" })),
    ];
    // amount is part of the key: stroke-width is derived from it, so an
    // amount-only change must still rebuild the edges.
    const key = all.map((e) => `${e.from}>${e.to}:${e.kind}:${e.amount}`).sort().join("|");
    if (key !== lastEdgeKey) {
      lastEdgeKey = key;
      gEdges.replaceChildren();
      const seen = new Map(); // node-pair -> count, to fan out parallel edges
      all.forEach((e, idx) => {
        const a0 = LAYOUT[e.from];
        const b0 = LAYOUT[e.to];
        if (!a0 || !b0) return;
        const pair = [e.from, e.to].sort().join("|");
        const dup = seen.get(pair) || 0;
        seen.set(pair, dup + 1);
        const a = trim(a0, b0, NODE_R + 1);
        const b = trim(b0, a0, NODE_R + 5);
        const path = el("path", {
          d: arc(a, b, dup * 14),
          class: `edge${e.kind === "ex" ? " edge-ex" : ""}`,
          "stroke-width": edgeWidth(e.amount),
          "marker-end": "url(#arrow)",
          fill: "none",
        });
        gEdges.append(path);
      });
    }

    prevMappingKeys = mappingKeys;
    firstPaint = false;
    if (newlyMerged.length) {
      caption.textContent = `${newlyMerged.map((k) => NODE_LABELS[k] || k).join(", ")} merged into the run. Net positions and settlement volume updated.`;
    }
  }

  return { render };
}
