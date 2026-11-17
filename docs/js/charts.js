/* Line charts with a crosshair tooltip, and the hourly series (actual, my forecast and range, official) behind them. */
import { st } from "./state.js?v=f618dea0d4";
import { VERDICT, css, fd, gw, hideTip, pct, row, showTip } from "./util.js?v=f618dea0d4";

const SER = {};

/* ---------- series helpers ---------- */
export async function loadSeries(ba) {
  if (!(ba in SER)) SER[ba] = await fetch(`data/series/${ba}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return SER[ba];
}
export function expand(d) {
  const t0 = Date.parse(d.t0.replace("Z", ":00Z"));
  const t = d.actual.map((_, i) => new Date(t0 + i * 36e5));
  return { t, actual: d.actual, official: d.official, p10: d.p10, p50: d.p50, p90: d.p90,
           live: t.map((_, i) => d.live_from != null && i >= d.live_from) };
}
export function slice(s, a, b) { const o = {}; for (const k in s) o[k] = s[k].slice(a, b); return o; }
export function lastDays(s, days) {
  const liveIdx = s.live.indexOf(true), end = s.t.length, histEnd = liveIdx >= 0 ? liveIdx : end;
  return slice(s, Math.max(0, histEnd - days * 24), end);
}
export const legendHTML = (compact) =>
  `<span class="key"><i class="sw line" style="background:${css("--actual")}"></i>Actual</span>` +
  `<span class="key"><i class="sw line" style="background:${css("--ours")}"></i>My forecast</span>` +
  `<span class="key"><i class="sw band"></i>My 80% range</span>` +
  `<span class="key"><i class="sw line" style="background:${css("--official")}"></i>Official${compact ? "" : " day-ahead forecast"}</span>`;

/* ---------- generic line chart with crosshair ---------- */
export function lineChart(el, o) {
  el.innerHTML = "";
  const W = el.clientWidth, H = el.clientHeight, m = { t: o.shadeLabel ? 26 : 10, r: 12, b: 28, l: o.compact ? 46 : 54 };
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", o.label || "Chart");
  const x = o.xScale.range([m.l, W - m.r]);
  const all = o.series.flatMap((s) => s.values).concat(o.band ? o.band.lo.concat(o.band.hi) : []).filter((v) => v != null && !isNaN(v));
  const ext = d3.extent(all), pad = (ext[1] - ext[0]) * 0.08 || 1;
  const y = d3.scaleLinear().domain(o.yZero ? [0, ext[1] + pad] : [ext[0] - pad, ext[1] + pad]).nice().range([H - m.b, m.t]);
  if (o.shade) svg.append("rect").attr("x", x(o.shade[0])).attr("width", Math.max(0, x(o.shade[1]) - x(o.shade[0])))
    .attr("y", m.t).attr("height", H - m.b - m.t).attr("fill", css("--live"));
  if (o.shade && o.shadeLabel) svg.append("text").attr("class", "lbl anno").attr("text-anchor", "end").attr("x", x(o.shade[1])).attr("y", m.t - 8).text(o.shadeLabel);   // above the plot, so no gridline or line crosses it
  svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(o.compact ? 4 : 5).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(o.compact ? 4 : 5).tickFormat(o.yFmt).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(o.xTicks || 6).tickFormat(o.xFmt).tickSizeOuter(0));
  const X = o.x;
  if (o.band) {
    const area = d3.area().defined((_, i) => o.band.lo[i] != null && o.band.hi[i] != null)
      .x((_, i) => x(X[i])).y0((_, i) => y(o.band.lo[i])).y1((_, i) => y(o.band.hi[i])).curve(d3.curveMonotoneX);
    svg.append("path").attr("d", area(X)).attr("fill", css("--ours-band"));
  }
  o.series.forEach((s, j) => {
    const line = d3.line().defined((v) => v != null && !isNaN(v)).x((_, i) => x(X[i])).y((v) => y(v)).curve(d3.curveMonotoneX);
    const p = svg.append("path").attr("d", line(s.values)).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 2)
      .attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
    if (o.animate) { const len = p.node().getTotalLength(); p.attr("class", "draw").style("--len", len).style("animation-delay", `${j * 0.25}s`); }
  });
  (o.notes || []).forEach((n) => {
    if (n.v == null || n.i == null) return;
    const px = x(X[n.i]), py = y(n.v), up = py - m.t > 46, ty = up ? py - 30 : py + 38;
    const anchor = px > W * 0.72 ? "end" : px < W * 0.28 ? "start" : "middle";
    const g = svg.append("g").attr("class", "note-mark").attr("aria-hidden", "true");
    g.append("circle").attr("cx", px).attr("cy", py).attr("r", 7).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
    g.append("line").attr("x1", px).attr("x2", px).attr("y1", up ? py - 8 : py + 8).attr("y2", up ? ty + 6 : ty - 16).attr("stroke", "var(--ink)").attr("stroke-width", 1);
    g.append("text").attr("class", "lbl anno").attr("x", px).attr("y", ty).attr("text-anchor", anchor).text(n.text);
  });
  const cross = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).attr("stroke", css("--axis")).style("display", "none");
  const dots = o.series.map((s) => svg.append("circle").attr("r", 4).attr("fill", s.color).attr("stroke", css("--surface")).attr("stroke-width", 2).style("display", "none"));
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", (ev) => {
      const [px] = d3.pointer(ev); const xv = x.invert(px);
      const i = d3.minIndex(X, (v) => Math.abs(+v - +xv));
      cross.attr("x1", x(X[i])).attr("x2", x(X[i])).style("display", null);
      o.series.forEach((s, j) => { const v = s.values[i]; dots[j].style("display", v == null ? "none" : null).attr("cx", x(X[i])).attr("cy", v == null ? 0 : y(v)); });
      showTip(o.tip(i), ev);
    })
    .on("mouseleave", () => { cross.style("display", "none"); dots.forEach((d) => d.style("display", "none")); hideTip(); });
}
export function drawSeries(el, s, ba, opt = {}) {
  const X = s.t, tz = (window.REGION_TZ || {})[ba];
  const fmtDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz });
  const fmtFull = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", timeZone: tz, timeZoneName: "short" });
  const liveIdx = s.live.map((v, i) => (v && s.actual[i] == null ? i : -1)).filter((i) => i >= 0);
  const shade = liveIdx.length ? [X[liveIdx[0]], X[liveIdx[liveIdx.length - 1]]] : null;
  const mw = (v) => (v == null ? "–" : d3.format(",.0f")(v) + " MW");
  let shadeLabel = null;
  if (shade) {
    const pk = liveIdx[d3.maxIndex(liveIdx, (i) => s.p50[i] ?? -Infinity)];
    const hourStr = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: tz }).format(new Date(+X[pk] - 36e5)).replace(" ", "\u00a0").toLowerCase();
    shadeLabel = s.p50[pk] != null ? `live forecast · peak ${gw(s.p50[pk])} at ${hourStr}` : "live forecast";
  }
  lineChart(el, {
    label: opt.label, animate: opt.animate, compact: opt.compact,
    x: X, xScale: d3.scaleTime().domain(d3.extent(X)), xFmt: (t) => fmtDay.format(t), xTicks: opt.compact ? 4 : 7,
    yFmt: (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + " GW" : v + " MW"),
    band: { lo: s.p10, hi: s.p90 }, shade, shadeLabel,
    series: [{ values: s.official, color: css("--official") }, { values: s.p50, color: css("--ours") }, { values: s.actual, color: css("--actual") }],
    tip: (i) => `<div class="t">${fmtFull.format(X[i])}</div>` + row("Actual", mw(s.actual[i]), css("--actual")) +
      row("My forecast", mw(s.p50[i]), css("--ours")) + row("My 80% range", s.p10[i] == null ? "–" : `${d3.format(",.0f")(s.p10[i])}–${d3.format(",.0f")(s.p90[i])}`) +
      row("Official forecast", mw(s.official[i]), css("--official")) +
      (s.live[i] ? `<div style="margin-top:4px;color:${css("--ink2")}">Live forecast, published the day before</div>` : ""),
  });
}
export function statsHTML(s, ba) {
  const meta = st.LB.find((r) => r.ba === ba);
  let eo = [], ef = [];
  s.actual.forEach((a, i) => { if (a > 0 && s.p50[i] != null && s.official[i] > 0) { eo.push(Math.abs(s.p50[i] - a) / a); ef.push(Math.abs(s.official[i] - a) / a); } });
  if (!meta) return "";
  return [[pct(d3.mean(eo), 2), `my error, last ${st.rangeDays} days`], [pct(d3.mean(ef), 2), `official error, last ${st.rangeDays} days`],
    [meta.suspect_official ? "Not scored" : `${VERDICT[meta.verdict].icon} ${VERDICT[meta.verdict].label}`, `full backtest since ${fd(st.S.backtest.start)}`],
  ].map(([v, l]) => `<div><b>${v}</b><br>${l}</div>`).join("");
}
