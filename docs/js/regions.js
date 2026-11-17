/* Region by region: the map and the sortable results table. */
import { st } from "./state.js?v=b26b5e6139";
import { $, $$, MINUS, VERDICT, css, fail, gw, hideTip, pct, reduceMotion, row, showTip } from "./util.js?v=b26b5e6139";
import { select } from "./explorer.js?v=b26b5e6139";

const MAPBASE = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json";
let US = null, filter = "all", sortKey = "mean_mw", sortDir = -1, tableAll = false;
const TABLE_TOP = 10;

/* ---------- map ---------- */
export const visible = (d) => filter === "all" || (!d.suspect_official && d.verdict === filter);
export async function renderMap() {
  const el = $("#map");
  try { if (!US) US = await d3.json(MAPBASE); } catch (e) { fail(el, "the map"); return; }
  el.innerHTML = "";
  const svg = d3.select(el).append("svg").attr("viewBox", "0 0 975 610").attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "group").attr("aria-label", "Map of the grid regions. Each dot is a region sized by average demand and colored by result; the same data is in the table below.");
  svg.append("g").attr("aria-hidden", "true").selectAll("path").data(topojson.feature(US, US.objects.states).features)
    .join("path").attr("class", "state").attr("d", d3.geoPath());
  const proj = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const r = d3.scaleSqrt().domain([0, d3.max(st.LB, (d) => d.mean_mw)]).range([0, 30]);
  const data = st.LB.filter((d) => proj([d.lon, d.lat])).sort((a, b) => b.mean_mw - a.mean_mw);
  const groups = d3.group(data, (d) => d.city);
  data.forEach((d) => {
    const [px, py] = proj([d.lon, d.lat]), g = groups.get(d.city);
    const k = g.indexOf(d), n = g.length, rad = n > 1 ? 14 : 0, a = (2 * Math.PI * k) / n - Math.PI / 2;
    d._x = px + rad * Math.cos(a); d._y = py + rad * Math.sin(a); d._r = Math.max(6, r(d.mean_mw));
  });
  svg.append("g").selectAll("circle").data(data).join("circle")
    .attr("class", (d) => "dot" + (d.ba === st.selected ? " sel" : "") + (visible(d) ? "" : " dim"))
    .attr("data-ba", (d) => d.ba)
    .attr("cx", (d) => d._x).attr("cy", (d) => d._y).attr("r", (d) => d._r)
    .attr("fill", (d) => (d.suspect_official ? "transparent" : VERDICT[d.verdict].color()))
    .attr("stroke", (d) => (d.suspect_official ? css("--muted") : null))
    .attr("stroke-dasharray", (d) => (d.suspect_official ? "3 2" : null))
    .attr("fill-opacity", 0.9)
    .attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", (d) => `${d.name}: ${d.suspect_official ? "official data unreliable, not scored" : VERDICT[d.verdict].label}. My error ${pct(d.mape_ours, 2)}, official ${pct(d.mape_official, 2)}. Press Enter to explore.`)
    .on("mousemove", (ev, d) => { showTip(regionTip(d), ev); highlight(d.ba, true); })
    .on("mouseleave", (ev, d) => { hideTip(); highlight(d.ba, false); })
    .on("focus", (ev, d) => { showTip(regionTip(d), ev); highlight(d.ba, true); })
    .on("blur", (ev, d) => { hideTip(); highlight(d.ba, false); })
    .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); goExplore(d.ba); } })
    .on("click", (ev, d) => goExplore(d.ba));
  const labelled = data.filter((d) => ["PJM", "MISO", "ERCO", "SWPP", "SOCO", "CISO", "NYIS", "ISNE"].includes(d.ba));
  svg.append("g").attr("aria-hidden", "true").selectAll("text").data(labelled).join("text")
    .attr("class", (d) => "maplabel" + (visible(d) ? "" : " dim"))
    .attr("x", (d) => d._x + d._r + 4).attr("y", (d) => d._y + 4).text((d) => d.ba);
  $("#mapLegend").innerHTML = ["win", "tie", "loss"].map((k) =>
    `<span class="key"><i class="sw" style="background:${VERDICT[k].color()}"></i>${VERDICT[k].icon} ${VERDICT[k].label} (${st.LB.filter((d) => !d.suspect_official && d.verdict === k).length})</span>`).join("") +
    `<span class="key"><i class="sw" style="border:1.5px dashed ${css("--muted")}"></i>Not scored (${st.LB.filter((d) => d.suspect_official).length})</span>`;
  const big = st.LB.filter((d) => !d.suspect_official).sort((a, b) => b.mean_mw - a.mean_mw).slice(0, 5);
  $("#mapTakeaway").innerHTML = `Of the five largest grids, my model wins <b>${big.filter((d) => d.verdict === "win").length}</b>, ties ${big.filter((d) => d.verdict === "tie").length} and loses ${big.filter((d) => d.verdict === "loss").length}. Hover or tab to any region for details; click to explore it.`;
}
export function regionTip(d) {
  const v = d.suspect_official ? "Official data unreliable (not scored)" : `${VERDICT[d.verdict].icon} ${VERDICT[d.verdict].label}`;
  return `<div class="t">${d.name}</div><div style="color:${css("--ink2")};margin-bottom:6px">${d.area} · ${gw(d.mean_mw)} average</div>` +
    row("My error", pct(d.mape_ours, 2), css("--ours")) + row("Official error", pct(d.mape_official, 2), css("--official")) +
    row("Days I was closer", pct(d.win_days, 0)) + row("p-value (Holm)", d.p_holm < 0.001 ? "< 0.001" : d.p_holm.toFixed(3)) +
    `<div style="margin-top:6px;font-weight:650">${v}</div>`;
}
export function highlight(ba, on) {
  $$(`#lb tbody tr[data-ba="${ba}"]`).forEach((tr) => tr.classList.toggle("hl", on));
  $$(`.dot[data-ba="${ba}"]`).forEach((c) => c.classList.toggle("hl", on));
}
export function goExplore(ba) { select(ba); document.getElementById("explore").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }

/* ---------- leaderboard ---------- */
export const COLS = [
  { k: "name", t: "Region" }, { k: "mean_mw", t: "Avg demand", num: true },
  { k: "mape_ours", t: "My error", num: true }, { k: "mape_official", t: "Official", num: true },
  { k: "improvement", t: "Difference", num: true }, { k: null, t: "Monthly trend" }, { k: "verdict", t: "Result" },
];
export function spark(m) {
  if (!m || m.length < 2) return "";
  const W = 96, H = 26, ys = m.flatMap((r) => [r[1], r[2]]);
  const x = d3.scaleLinear().domain([0, m.length - 1]).range([2, W - 2]);
  const y = d3.scaleLinear().domain([0, d3.max(ys) * 1.05]).range([H - 2, 2]);
  const line = (i) => d3.line().x((_, j) => x(j)).y((r) => y(r[i]))(m);
  return `<svg class="spark" width="${W}" height="${H}" role="img" aria-label="Monthly error: mine ${pct(m[m.length - 1][1], 1)}, official ${pct(m[m.length - 1][2], 1)} in the latest month">` +
    `<path d="${line(2)}" fill="none" stroke="${css("--official")}" stroke-width="1.5"/><path d="${line(1)}" fill="none" stroke="${css("--ours")}" stroke-width="1.5"/></svg>`;
}
export function renderTable() {
  const show = $("#showSuspect").checked;
  const rows = st.LB.filter((d) => (show || !d.suspect_official) && visible(d)).slice().sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir;
  });
  const total = rows.length;
  if (!tableAll && total > TABLE_TOP + 2) rows.splice(TABLE_TOP);
  const more = $("#lbMore");
  more.hidden = total <= TABLE_TOP + 2;
  more.textContent = tableAll ? "Show the first 10 only" : `Show all ${total} regions`;
  more.setAttribute("aria-expanded", String(tableAll));
  const maxImp = Math.min(0.6, d3.max(st.LB.filter((d) => !d.suspect_official), (d) => Math.abs(d.improvement)) || 0.1);
  $("#lb thead").innerHTML = "<tr>" + COLS.map((c) => {
    if (!c.k) return `<th>${c.t}</th>`;
    const on = sortKey === c.k, dir = on ? (sortDir > 0 ? "ascending" : "descending") : "none";
    return `<th class="${c.num ? "num" : ""}" data-k="${c.k}" aria-sort="${dir}"><button type="button">${c.t}${on ? (sortDir > 0 ? " ↑" : " ↓") : ""}</button></th>`;
  }).join("") + "</tr>";
  $("#lb tbody").innerHTML = rows.length ? rows.map((d) => {
    const w = Math.min(1, Math.abs(d.improvement) / maxImp) * 56;
    const better = d.improvement >= 0;
    const bar = `<svg width="116" height="12" aria-hidden="true"><line x1="58" x2="58" y1="0" y2="12" stroke="${css("--axis")}"/>` +
      `<rect x="${better ? 59 : 57 - w}" y="2" width="${Math.max(1, w)}" height="8" rx="2" fill="${better ? css("--ours") : css("--official")}"/></svg>`;
    const label = (better ? MINUS : "+") + Math.abs(d.improvement * 100).toFixed(0) + "%";
    const badge = d.suspect_official ? `<span class="badge-r suspect">Not scored</span>`
      : `<span class="badge-r ${VERDICT[d.verdict].cls}">${VERDICT[d.verdict].icon} ${VERDICT[d.verdict].short}</span>`;
    return `<tr data-ba="${d.ba}" tabindex="0" aria-label="${d.name}, open in explorer"><td class="reg"><b>${d.name}</b><span>${d.ba} · ${d.area}</span></td>` +
      `<td class="num" data-label="Avg demand">${gw(d.mean_mw)}</td><td class="num" data-label="My error">${pct(d.mape_ours, 2)}</td><td class="num" data-label="Official">${pct(d.mape_official, 2)}</td>` +
      `<td class="num diff" data-label="Difference"><span class="impbar" title="${better ? "My error is lower" : "Official error is lower"}">${bar}<span>${label}</span></span></td>` +
      `<td class="trend">${spark(d.monthly)}</td><td class="res">${badge}</td></tr>`;
  }).join("") : `<tr><td colspan="7" class="note">No regions match this filter.</td></tr>`;
  $$("#lb thead th[data-k] button").forEach((btn) => btn.addEventListener("click", () => {
    const k = btn.parentElement.dataset.k; sortDir = sortKey === k ? -sortDir : (["name", "verdict", "mape_ours", "mape_official"].includes(k) ? 1 : -1); sortKey = k; renderTable();
    $(`#lb thead th[data-k="${k}"] button`).focus();
  }));
  $$("#lb tbody tr[data-ba]").forEach((tr) => {
    tr.addEventListener("click", () => goExplore(tr.dataset.ba));
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") goExplore(tr.dataset.ba); });
    tr.addEventListener("mouseenter", () => highlight(tr.dataset.ba, true));
    tr.addEventListener("mouseleave", () => highlight(tr.dataset.ba, false));
  });
  $("#sparkNote").innerHTML = `<span class="key"><i class="sw line" style="background:${css("--ours")}"></i>My monthly error</span> <span class="key"><i class="sw line" style="background:${css("--official")}"></i>Official</span>`;
  $("#lbNote").textContent = "Error = mean absolute percentage error per hour. Difference = how much lower my error is than the official one (blue: mine is lower, orange: theirs is lower). A Win or Loss needs a Holm-corrected Diebold-Mariano p-value below 0.05.";
}
export function setFilter(f) {
  filter = f;
  $$("#filters .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === f)));
  d3.selectAll(".dot").classed("dim", (d) => !visible(d));
  d3.selectAll(".maplabel").classed("dim", (d) => !visible(d));
  renderTable();
}

export function toggleTable() { tableAll = !tableAll; renderTable(); if (!tableAll) $("#lb").scrollIntoView({ block: "nearest" }); }
