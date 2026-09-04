// scatter.js — the ablation as a picture, not a table.
//
// Plots the 14 labelled pairs: string similarity (x) against semantic
// similarity (y). The pairs the embedding layer recovers land in the
// high-semantic / low-fuzzy corner — so the shaded rectangle in that corner
// *is* the argument "this is what the embedding sees that string matching
// cannot," drawn rather than asserted.
//
// Pure SVG, no library — same approach as graph.js. Thresholds come from
// pipeline.js so the plot stays honest if they move.

import { HIGH, FUZZY_CANDIDATE } from "./pipeline.js";

const NS = "http://www.w3.org/2000/svg";
const VB = { w: 360, h: 300 };
const PLOT = { l: 46, r: 344, t: 22, b: 240 };
const X_PAD = 12; // data inset from the y-axis, so the fuzzy≈0 recovered pairs
                  // read as "near zero" rather than fused with the axis line
const Y_MIN = 0.2; // MiniLM cosines never approach 0 on this set — an honest floor.

const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const txt = (x, y, s, cls, anchor = "start") => {
  const t = el("text", { x, y, class: cls, "text-anchor": anchor });
  t.textContent = s;
  return t;
};

const ROUTE = { AUTO_MERGE: "auto-merge", REVIEW_REQUIRED: "review", KEEP_SEPARATE: "keep separate" };

const sx = (f) => PLOT.l + X_PAD + f * (PLOT.r - PLOT.l - X_PAD);
const sy = (s) =>
  PLOT.b - ((Math.min(Math.max(s, Y_MIN), 1) - Y_MIN) / (1 - Y_MIN)) * (PLOT.b - PLOT.t);

const isRecovered = (r) =>
  r.fuzzyOnly === "KEEP_SEPARATE" && r.full !== "KEEP_SEPARATE" && r.truth !== "separate";

export function createScatter(container) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  function render(rows) {
    container.replaceChildren();
    const svg = el("svg", { viewBox: `0 0 ${VB.w} ${VB.h}`, class: "scatter" });

    // recovered quadrant
    const qx = sx(FUZZY_CANDIDATE);
    const qy = sy(HIGH);
    svg.append(el("rect", { x: PLOT.l, y: PLOT.t, width: qx - PLOT.l, height: qy - PLOT.t, class: "sc-zone" }));
    const mid = (PLOT.l + qx) / 2;
    const zl = el("text", { x: mid, y: PLOT.t + 20, class: "sc-zone-label", "text-anchor": "middle" });
    ["RECOVERED BY THE", "EMBEDDING LAYER"].forEach((line, i) => {
      const ts = document.createElementNS(NS, "tspan");
      ts.setAttribute("x", mid);
      if (i) ts.setAttribute("dy", 11);
      ts.textContent = line;
      zl.append(ts);
    });
    svg.append(zl);

    // threshold lines
    svg.append(el("line", { x1: qx, y1: PLOT.t, x2: qx, y2: PLOT.b, class: "sc-thresh" }));
    svg.append(el("line", { x1: PLOT.l, y1: qy, x2: PLOT.r, y2: qy, class: "sc-thresh" }));
    svg.append(txt(qx + 4, PLOT.t + 9, `fuzzy ${FUZZY_CANDIDATE.toFixed(2)}`, "sc-thresh-label", "start"));
    svg.append(txt(PLOT.r, qy - 5, `gate ${HIGH.toFixed(2)}`, "sc-thresh-label", "end"));

    // axes + ticks
    svg.append(el("line", { x1: PLOT.l, y1: PLOT.t, x2: PLOT.l, y2: PLOT.b, class: "sc-axis" }));
    svg.append(el("line", { x1: PLOT.l, y1: PLOT.b, x2: PLOT.r, y2: PLOT.b, class: "sc-axis" }));
    [0, 0.5, 1].forEach((f) => svg.append(txt(sx(f), PLOT.b + 14, f.toFixed(1), "sc-tick", "middle")));
    [0.2, 0.6, 1].forEach((s) => svg.append(txt(PLOT.l - 6, sy(s) + 3, s.toFixed(1), "sc-tick", "end")));
    svg.append(txt((PLOT.l + PLOT.r) / 2, VB.h - 6, "string similarity", "sc-title", "middle"));
    const yt = txt(12, (PLOT.t + PLOT.b) / 2, "semantic similarity", "sc-title", "middle");
    yt.setAttribute("transform", `rotate(-90 12 ${(PLOT.t + PLOT.b) / 2})`);
    svg.append(yt);

    // points — non-recovered first, recovered painted on top
    const g = el("g", { class: "sc-points" });
    svg.append(g);

    const cap = document.createElement("div");
    cap.className = "scatter-caption";
    cap.textContent = "Tap a point for the pair and how each pipeline routed it.";

    const ordered = [...rows.filter((r) => !isRecovered(r)), ...rows.filter(isRecovered)];
    ordered.forEach((r, i) => {
      const cx = sx(r.fuzzy);
      const cy = sy(r.semantic);
      if (isRecovered(r)) g.append(el("circle", { cx, cy, r: 8, class: "sc-halo" }));
      const dot = el("circle", { cx, cy, r: 4.5, tabindex: "0", class: `sc-pt sc-${r.truth}` });
      const say = () => {
        cap.textContent = `${r.a} ↔ ${r.b}  —  fuzzy-only: ${ROUTE[r.fuzzyOnly]} · with embedding: ${ROUTE[r.full]}`;
      };
      dot.addEventListener("click", say);
      dot.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); say(); }
      });
      g.append(dot);
      if (!reduce.matches) {
        dot.animate(
          [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
          { duration: 340, delay: i * 22, easing: "cubic-bezier(0.22,1,0.36,1)", fill: "backwards" }
        );
      }
    });

    // legend
    const legend = document.createElement("div");
    legend.className = "scatter-legend";
    [["sc-merge", "same entity"], ["sc-review", "real relationship"], ["sc-separate", "unrelated / conflict"]]
      .forEach(([cls, label]) => {
        const s = document.createElement("span");
        const i = document.createElement("i");
        i.className = "lg " + cls;
        s.append(i, document.createTextNode(label));
        legend.append(s);
      });

    container.append(svg, legend, cap);
  }

  return { render };
}
