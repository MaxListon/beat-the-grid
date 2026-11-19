/* Plain-language definitions for the jargon, shown on hover, tap or keyboard focus (first use in each section). */
import { hideTip, showTip } from "./util.js?v=3f8233ccc6";

/* ---------- plain-language definitions for the jargon (first use in each section) ---------- */
export const GLOSSARY = [
  [/\bbalancing authorit(?:y|ies)\b/i, "Balancing authority", "The organization that keeps electricity supply and demand matched, second by second, on its part of the grid. This contest scores 34 of them."],
  [/\bday-ahead (?:demand )?forecasts?\b/i, "Day-ahead forecast", "A prediction, made the day before, of how much electricity a region will use each hour. Operators use it to decide which power plants to schedule."],
  [/\bmean absolute percentage error\b|\bMAPE\b|\baverage (?:hourly )?error\b/i, "Average error", "How far off a forecast is, on average, as a percent of what actually happened. 3% means a typical hour was off by 3%. Lower is better."],
  [/\bweighted by demand\b|\bdemand-weighted\b/i, "Weighted by demand", "Big grids count more than small ones, in proportion to how much electricity they use, so the result reflects where power is actually used."],
  [/\b80% range\b/i, "80% range", "Besides one number, my model gives a low and a high value for each hour. If that range is honest, actual demand lands inside it about 80% of the time."],
  [/\bDiebold-Mariano\b/i, "Diebold-Mariano test", "A standard statistical test of whether one forecast is genuinely more accurate than another, or whether the gap could just be luck."],
  [/\bHolm(?:-corrected| correction)?\b/i, "Holm correction", "An adjustment for running many tests at once (one per region), so that a few lucky results don't get counted as wins."],
  [/\bstatistically significant\b/i, "Statistically significant", "Unlikely to be luck: the difference held up under the Diebold-Mariano test with Holm correction (p < 0.05)."],
  [/\bwalk-forward\b/i, "Walk-forward", "Testing that mimics real life: the model is retrained every quarter using only past data, then scored on the next quarter, which it has never seen."],
  [/\bbacktest\b/i, "Backtest", "Scoring a model on past data as if it had been running at the time, using only the information it would have had then."],
  [/\bSHAP\b/, "SHAP values", "A method that splits a model's prediction into the contribution of each input. Here it shows what pushed a forecast up or down."],
  [/\bdaily peak\b/i, "Daily peak", "The day's single highest hour of demand, when the most expensive standby power plants have to run."],
];
export const SKIP = "a,button,select,option,svg,h1,h2,h3,label,summary,.term,.tip,.ticker,table,.kicker,.eyebrow,script,style,code,pre,.sql-card";
export function glossify(scope) {
  if (!scope) return;
  const seen = new Set([...scope.querySelectorAll(".term")].map((t) => +t.dataset.k));   // already explained in this section
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim().length > 3 && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    for (let k = 0; k < GLOSSARY.length; k++) {
      if (seen.has(k)) continue;
      const m = GLOSSARY[k][0].exec(node.nodeValue);
      if (!m) continue;
      seen.add(k);
      const after = node.splitText(m.index), rest = after.splitText(m[0].length);
      const span = document.createElement("span");
      span.className = "term"; span.tabIndex = 0; span.dataset.k = k; span.textContent = after.nodeValue;
      span.setAttribute("aria-label", `${after.nodeValue}: ${GLOSSARY[k][2]}`);
      after.replaceWith(span);
      glossifyNode(rest, seen);
      break;
    }
  }
}
export function glossifyNode(node, seen) {           // keep scanning the remainder of a split text node
  for (let k = 0; k < GLOSSARY.length; k++) {
    if (seen.has(k)) continue;
    const m = GLOSSARY[k][0].exec(node.nodeValue);
    if (!m) continue;
    seen.add(k);
    const after = node.splitText(m.index), rest = after.splitText(m[0].length);
    const span = document.createElement("span");
    span.className = "term"; span.tabIndex = 0; span.dataset.k = k; span.textContent = after.nodeValue;
    span.setAttribute("aria-label", `${after.nodeValue}: ${GLOSSARY[k][2]}`);
    after.replaceWith(span);
    glossifyNode(rest, seen);
    return;
  }
}
export function bindGlossary() {
  const html = (el) => { const g = GLOSSARY[+el.dataset.k]; return `<div class="t">${g[1]}</div><div class="def">${g[2]}</div>`; };
  let pinned = null;
  document.addEventListener("mouseover", (e) => { const t = e.target.closest(".term"); if (t && !pinned) showTip(html(t), e); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest(".term") && !pinned) hideTip(); });
  document.addEventListener("focusin", (e) => { const t = e.target.closest(".term"); if (t) showTip(html(t), { type: "focus", target: t }); });
  document.addEventListener("focusout", (e) => { if (e.target.closest(".term")) { pinned = null; hideTip(); } });
  document.addEventListener("click", (e) => {                    // tap on touch screens
    const t = e.target.closest(".term");
    if (t) { pinned = pinned === t ? null : t; if (pinned) showTip(html(t), { type: "focus", target: t }); else hideTip(); }
    else if (pinned) { pinned = null; hideTip(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { pinned = null; hideTip(); } });
}
