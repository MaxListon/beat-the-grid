/* When the model wins: by hour, by month, on peak days; the peak contest; the blend; the worst days. */
import { st } from "./state.js?v=3f8233ccc6";
import { $, $$, MINUS, VERDICT, css, fail, fd, hideTip, pct, row, showTip } from "./util.js?v=3f8233ccc6";
import { lineChart } from "./charts.js?v=3f8233ccc6";
import { observeReveal } from "./main.js?v=3f8233ccc6";

/* ---------- when we win ---------- */
export function renderWhen() {
  const ser = (rows, key) => rows.map((r) => r[key]);
  const H = st.BR.by_hour || [], M = st.BR.by_month || [];
  const legend2 = `<span class="key"><i class="sw line" style="background:${css("--ours")}"></i>My error</span>` +
    `<span class="key"><i class="sw line" style="background:${css("--official")}"></i>Official error</span>`;
  $$(".legend2").forEach((el) => { el.innerHTML = legend2; });
  const hr = (h) => (h === 0 ? "midnight" : h < 12 ? h + " am" : h === 12 ? "noon" : h - 12 + " pm");
  if (H.length) {
    const hedge = H.map((r) => r.ape_official - r.ape_ours), hb = d3.maxIndex(hedge), hw = d3.minIndex(hedge);
    lineChart($("#hourChart"), {
      notes: [{ i: hb, v: H[hb].ape_ours, text: "my best hour" }].concat(hedge[hw] < 0 ? [{ i: hw, v: H[hw].ape_official, text: "operators' edge" }] : []),
      label: "Average forecast error by local hour of day, my model versus the official forecast. Values in the tooltip and caption.",
      x: H.map((r) => r.hour), xScale: d3.scaleLinear().domain([0, 23]), xFmt: (h) => (h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : h - 12 + "p"),
      yFmt: (v) => (v * 100).toFixed(1) + "%", yZero: true,
      series: [{ values: ser(H, "ape_official"), color: css("--official") }, { values: ser(H, "ape_ours"), color: css("--ours") }],
      tip: (i) => `<div class="t">Local hour ${H[i].hour}:00</div>` + row("My error", pct(H[i].ape_ours, 2), css("--ours")) + row("Official error", pct(H[i].ape_official, 2), css("--official")),
    });
    const won = H.filter((r) => r.ape_ours < r.ape_official).length, edge = H.map((r) => r.ape_official - r.ape_ours);
    const best = H[d3.maxIndex(edge)].hour, worst = H[d3.minIndex(edge)].hour;
    $("#hourCap").textContent = won === 24 ? `My error is lower at every hour, most of all around ${hr(best)}.`
      : won === 0 ? `The official forecast is more accurate at every hour; the gap is smallest around ${hr(best)}.`
      : `Lower in ${won} of 24 hours: best around ${hr(best)}, worst around ${hr(worst)}.`;
    $("#whenTakeaway").innerHTML = `On regions with genuine official forecasts, my model is more accurate in <b>${won} of 24 hours</b>, strongest around ${hr(best)}. The operators are better around ${hr(worst)}, when their real-time information matters most.`;
  }
  if (M.length) {
    const X = M.map((r) => new Date(r.month + "-15"));
    const medge = M.map((r) => r.ape_official - r.ape_ours), mb = d3.maxIndex(medge), mw_ = d3.minIndex(medge);
    lineChart($("#monthChart"), {
      notes: [{ i: mb, v: M[mb].ape_ours, text: "my best month" }].concat(medge[mw_] < 0 ? [{ i: mw_, v: M[mw_].ape_ours, text: "my worst month" }] : []),
      label: "Average forecast error by month, my model versus the official forecast.",
      x: X, xScale: d3.scaleTime().domain(d3.extent(X)), xFmt: d3.timeFormat("%b %y"), xTicks: 6,
      yFmt: (v) => (v * 100).toFixed(1) + "%", yZero: true,
      series: [{ values: ser(M, "ape_official"), color: css("--official") }, { values: ser(M, "ape_ours"), color: css("--ours") }],
      tip: (i) => `<div class="t">${d3.timeFormat("%B %Y")(X[i])}</div>` + row("My error", pct(M[i].ape_ours, 2), css("--ours")) + row("Official error", pct(M[i].ape_official, 2), css("--official")),
    });
    const won = M.filter((r) => r.ape_ours < r.ape_official).length, edge = M.map((r) => r.ape_official - r.ape_ours), fm = d3.timeFormat("%B %Y");
    $("#monthCap").textContent = `Lower in ${won} of ${M.length} months. Best: ${fm(X[d3.maxIndex(edge)])}.` + (d3.min(edge) < 0 ? ` Worst: ${fm(X[d3.minIndex(edge)])}.` : "");
  }
  const D = (st.BR.by_daytype || []).slice().sort((a, b) => order(a.day_type) - order(b.day_type));
  if (D.length) renderDayBars(D);
}
export const order = (t) => (t.startsWith("Busiest") ? 0 : t.startsWith("All") ? 1 : 2);
export function renderDayBars(D) {
  const el = $("#dayChart"); el.innerHTML = "";
  const W = el.clientWidth, narrow = W < 520;
  const H = narrow ? 260 : 200, m = { t: 8, r: 64, b: 8, l: narrow ? 0 : 160 };
  el.style.height = H + "px";
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", "Average error by type of day: " + D.map((d) => `${d.day_type}: mine ${pct(d.ape_ours, 2)}, official ${pct(d.ape_official, 2)}`).join("; "));
  const y0 = d3.scaleBand().domain(D.map((d) => d.day_type)).range([m.t, H - m.b]).paddingInner(0.3);
  const y1 = d3.scaleBand().domain(["ape_ours", "ape_official"]).range([narrow ? 18 : 0, y0.bandwidth()]).paddingInner(0.15);
  const x = d3.scaleLinear().domain([0, d3.max(D, (d) => Math.max(d.ape_ours, d.ape_official)) * 1.1]).range([m.l, W - m.r]);
  const col = { ape_ours: css("--ours"), ape_official: css("--official") }, name = { ape_ours: "My error", ape_official: "Official error" };
  D.forEach((d) => {
    if (narrow) svg.append("text").attr("class", "lbl").attr("x", 0).attr("y", y0(d.day_type) + 12).text(d.day_type);
    else svg.append("text").attr("class", "lbl").attr("x", m.l - 10).attr("y", y0(d.day_type) + y0.bandwidth() / 2).attr("dy", "0.35em").attr("text-anchor", "end").text(d.day_type);
    ["ape_ours", "ape_official"].forEach((k) => {
      const yy = y0(d.day_type) + y1(k);
      svg.append("rect").attr("x", m.l).attr("y", yy).attr("height", y1.bandwidth()).attr("width", Math.max(1, x(d[k]) - m.l)).attr("rx", 3).attr("fill", col[k])
        .on("mousemove", (ev) => showTip(`<div class="t">${d.day_type}</div>` + row(name[k], pct(d[k], 2), col[k]), ev)).on("mouseleave", hideTip);
      svg.append("text").attr("class", "lbl").attr("x", x(d[k]) + 6).attr("y", yy + y1.bandwidth() / 2).attr("dy", "0.35em").text(pct(d[k], 2));
    });
  });
  const peak = D.find((d) => d.day_type.startsWith("Busiest"));
  $("#dayCap").innerHTML = `Peak days decide how many expensive standby plants run, so errors there cost the most. ` +
    (peak ? (peak.ape_ours < peak.ape_official ? `On each region's busiest 5% of days, my error was <b>${pct(peak.ape_ours, 2)}</b> vs <b>${pct(peak.ape_official, 2)}</b> official.` : `On each region's busiest 5% of days the official forecast did better: <b>${pct(peak.ape_official, 2)}</b> vs my <b>${pct(peak.ape_ours, 2)}</b>.`) : "") +
    ` <span class="key" style="margin-left:6px"><i class="sw line" style="background:${css("--ours")}"></i>Mine</span> <span class="key"><i class="sw line" style="background:${css("--official")}"></i>Official</span>`;
}

/* ---------- the peak contest ---------- */
let peakAll = false;
export function renderPeaks() {
  const P = window.PEAKS; if (!P) { fail($("#peakChart"), "the peak contest"); return; }
  const h = P.headline;
  const cut = 1 - h.peak_blend / h.peak_official;
  $("#peakTakeaway").innerHTML = `Operators care most about each day's highest hour, when the most expensive plants run. Here they're clearly better: significantly more accurate in <b>${h.losses} of ${h.regions}</b> regions, against ${h.wins} for my model. Blended with my model, though, their peak error drops by <b>${pct(cut, 0)}</b>.`;
  $("#peakTiles").innerHTML = [
    [pct(h.peak_ours, 2), "my daily peak error (demand-weighted)"],
    [pct(h.peak_official, 2), "operators' daily peak error"],
    [pct(h.peak_blend, 2), `blended peak error, better than official in ${h.blend_beats_official} of ${h.regions} regions`],
    [`${pct(h.hit_ours, 0)} vs ${pct(h.hit_official, 0)}`, "of days the peak hour was called within ±1 hour (mine vs official)"],
  ].map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#peakLegend").innerHTML = `<span class="key"><i class="sw dotk" style="background:${css("--ours")}"></i>My peak error</span><span class="key"><i class="sw dotk" style="background:${css("--official")}"></i>Official</span>`;
  const rows = P.regions.filter((r) => !r.suspect_official);
  const shown = peakAll ? rows : rows.slice(0, 12);
  $("#peakCap").textContent = `${peakAll ? `All ${rows.length}` : "The 12 largest"} regions, largest first. Each line joins the two forecasts' average error on the day's peak; the dot further left was more accurate. ✓/✕ marks a statistically significant win or loss.`;
  const more = $("#peakMore");
  more.textContent = peakAll ? "Show the 12 largest" : `Show all ${rows.length} regions`; more.setAttribute("aria-expanded", String(peakAll));
  const el = $("#peakChart"); el.innerHTML = "";
  const W = el.clientWidth, narrow = W < 560, rh = 30;
  const m = { t: 8, r: 40, b: 28, l: narrow ? 64 : 200 };
  const H = m.t + m.b + shown.length * rh; el.style.height = H + "px";
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", "Daily peak error by region: " + shown.map((r) => `${r.name}: mine ${pct(r.peak_ours, 1)}, official ${pct(r.peak_official, 1)}`).join("; "));
  const x = d3.scaleLinear().domain([0, Math.min(0.12, d3.max(shown, (r) => Math.max(r.peak_ours, r.peak_official)) * 1.08)]).range([m.l, W - m.r]).nice();
  svg.append("g").attr("class", "gridline").attr("transform", `translate(0,${m.t})`).call(d3.axisTop(x).ticks(narrow ? 4 : 6).tickSize(-(H - m.t - m.b)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(narrow ? 4 : 6).tickFormat((v) => (v * 100).toFixed(0) + "%").tickSizeOuter(0));
  const cx = (v) => x(Math.min(v, x.domain()[1]));
  shown.forEach((r, i) => {
    const y = m.t + i * rh + rh / 2, v = VERDICT[r.verdict];
    const g = svg.append("g").attr("class", "pk-row")
      .on("mousemove", (ev) => showTip(`<div class="t">${r.name}</div>` + row("My peak error", pct(r.peak_ours, 2), css("--ours")) + row("Official", pct(r.peak_official, 2), css("--official")) +
        row("Blend", pct(r.peak_blend, 2)) + row("Peak hour within ±1 h", `${pct(r.hit_ours, 0)} vs ${pct(r.hit_official, 0)}`) + row("Days", d3.format(",")(r.days)) +
        `<div style="margin-top:6px;font-weight:650">${v.icon} ${r.verdict === "tie" ? "No significant difference" : r.verdict === "win" ? "My model calls the peak better" : "Official calls the peak better"}</div>`, ev))
      .on("mouseleave", hideTip);
    g.append("rect").attr("x", 0).attr("y", y - rh / 2).attr("width", W).attr("height", rh).attr("fill", "transparent");
    g.append("text").attr("class", "lbl").attr("x", m.l - 10).attr("y", y).attr("dy", "0.35em").attr("text-anchor", "end").text(narrow ? r.ba : r.name);
    g.append("line").attr("x1", cx(r.peak_ours)).attr("x2", cx(r.peak_official)).attr("y1", y).attr("y2", y).attr("stroke", css("--axis")).attr("stroke-width", 2);
    [["peak_official", "--official"], ["peak_ours", "--ours"]].forEach(([k, c]) =>
      g.append("circle").attr("cx", cx(r[k])).attr("cy", y).attr("r", 6).attr("fill", css(c)).attr("stroke", css("--surface")).attr("stroke-width", 2));
    g.append("text").attr("class", "lbl").attr("x", W - m.r + 12).attr("y", y).attr("dy", "0.35em").attr("fill", css({ win: "--ours-text", loss: "--official-text", tie: "--muted" }[r.verdict])).style("font-weight", 700).text(v.icon);
  });
  const tried = h.peak_model_tried || {};
  $("#peakNote").innerHTML = `<p>For each region-day with at least 23 scored hours, the peak is the highest hour. Peak error = how far each forecast's highest hour is from the real one, as a share of it. Timing counts as right if the forecast's highest hour is within one hour of the real one. Wins and losses use the same Diebold-Mariano test with Holm correction as the main contest, over ${d3.format(",")(h.days)} region-days.</p>` +
    `<p><b>What I tried:</b> a separate model trained only to predict each day's peak (walk-forward, settings chosen on the never-scored April–June 2024 window). It was <em>less</em> accurate than simply taking the highest hour of my hourly forecast (${pct(tried.peak_model, 2)} vs ${pct(tried.hourly_max, 2)}), so I didn't adopt it. The operators' edge here likely comes from information a public model doesn't have, such as same-morning load data and local knowledge of large customers.</p>`;
}

/* ---------- better together ---------- */
export function renderBlend() {
  const h = st.S.headline, B = window.BLEND || {}, V = window.VALUE || {};
  if (!h || h.load_weighted_mape_blend == null) return;
  const cut = 1 - h.load_weighted_mape_blend / h.load_weighted_mape_official;
  $("#togetherTakeaway").innerHTML = `The two forecasts make different mistakes. Blending them, with weights learned only from earlier quarters, cuts the operators' error by <b>${pct(cut, 0)}</b> and beats the official forecast alone in <b>${h.blend_beats_official} of ${h.regions_fair}</b> regions.`;
  $("#blendTiles").innerHTML = [
    [pct(h.load_weighted_mape_blend, 2), "error of the blended forecast (demand-weighted)"],
    [pct(h.load_weighted_mape_official, 2), "error of the official forecast alone"],
    [MINUS + pct(cut, 0), "less error than the official forecast alone"],
    [`${h.blend_beats_official} of ${h.regions_fair}`, "regions where the blend beats the official forecast"],
  ].map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join("");
  const W = B.weights || {}, parts = B.dayparts || {};
  const rows = st.LB.filter((d) => !d.suspect_official && W[d.ba]).sort((a, b) => b.mean_mw - a.mean_mw);
  const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  const ramp = d3.interpolateRgb(dark ? "#1d2a3a" : "#e7f0fc", dark ? "#6da7ec" : "#1c5cab");
  const ink = (w) => (dark ? (w > 0.6 ? "#0b0b0b" : "#f0efec") : (w > 0.5 ? "#ffffff" : "#0b0b0b"));
  $("#blendTable").innerHTML = `<caption class="sr-only">Blend weights by region and time of day</caption><thead><tr><th>Region</th>${Object.values(parts).map((p) => `<th class="num">${p}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((d, i) => `<tr${i >= 10 ? ' class="extra"' : ""}><td class="reg"><b>${d.name}</b><span>${d.ba}</span></td>` +
      Object.keys(parts).map((k) => { const w = W[d.ba][k]; return `<td class="w" style="background:${ramp(w)};color:${ink(w)}" title="${d.name}, ${parts[k]}: ${Math.round(w * 100)}% my model">${Math.round(w * 100)}%</td>`; }).join("") + `</tr>`).join("") + `</tbody>`;
  const more = $("#blendMore"), table = $("#blendTable");
  more.hidden = rows.length <= 12;
  const label = () => { const all = table.classList.contains("all"); more.textContent = all ? "Show the 10 largest only" : `Show all ${rows.length} regions`; more.setAttribute("aria-expanded", String(all)); };
  label();
  more.onclick = () => { table.classList.toggle("all"); label(); };
  const t = V.totals;
  $("#valueNote").innerHTML = (t ? `<p>Over a year, the official forecasts in these regions mis-forecast about <b>${d3.format(",.0f")(t.gwh_official / 1000)} TWh</b> of electricity; the blend, <b>${d3.format(",.0f")(t.gwh_blend / 1000)} TWh</b>. At average 2026 wholesale prices that energy is worth about <b>$${(t.usd_official / 1e9).toFixed(1)} billion</b> versus <b>$${(t.usd_blend / 1e9).toFixed(1)} billion</b> a year. That's an illustration of scale, not a cost estimate: the real cost of forecast errors depends on reserves and balancing markets and is a fraction of the energy's value. Prices: ${V.price_source}.</p>` : "") +
    `<p>How it was tested: for each quarter, the weights were learned only from earlier quarters, where my forecasts were themselves out-of-sample. The first quarter used a plain 50/50 average. This answers a different question from the contest (the operator's forecast may be published after my issue time): how much would an operator gain by adding my model to its own?</p>`;
}

/* ---------- misses ---------- */
export function renderMisses() {
  const M = window.MISSES || [], el = $("#missList");
  if (!M.length) { fail(el, "this analysis"); return; }
  const t = (c) => (c == null ? "–" : `${c.toFixed(0)}°C`);
  el.innerHTML = M.map((m) => `<article class="card miss reveal"><h3>${m.name}</h3>` +
    `<div class="when">${m.weekday}, ${fd(m.date)} · ${m.ba}</div>` +
    `<div class="nums"><span>My error <b>${pct(m.mape_mine, 1)}</b></span><span>Official <b>${pct(m.mape_official, 1)}</b></span>` +
    `<span>High: forecast <b>${t(m.fc_temp_max)}</b>, actual <b>${t(m.obs_temp_max)}</b></span></div>` +
    `<p>${m.explanation || ""}</p></article>`).join("");
  observeReveal();
}

export function togglePeaks() { peakAll = !peakAll; renderPeaks(); }
