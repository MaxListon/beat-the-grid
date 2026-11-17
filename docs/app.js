/* Beat the Grid: front end. Reads docs/data/*.json written by grid/site_data.py. Every sentence that
 * states a number is assembled from the data, so the text can never drift from the results. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const pct = (x, d = 1) => (x == null || isNaN(x) ? "–" : (x * 100).toFixed(d) + "%");
  const gw = (mw) => (mw == null ? "–" : (mw >= 10000 ? (mw / 1000).toFixed(0) : (mw / 1000).toFixed(1)) + " GW");
  const MINUS = "−";
  const isoLocal = (d) => d.toLocaleDateString("en-CA");          // YYYY-MM-DD in the visitor's time zone
  const relDay = (iso) => { const t = new Date(); if (iso === isoLocal(t)) return "Today"; t.setDate(t.getDate() + 1); return iso === isoLocal(t) ? "Tomorrow" : ""; };
  // "2026-11-17" -> "Nov 17, 2026" (or "Nov 17"); dates are calendar days, so format in UTC at noon
  const fd = (iso, year = true) => (iso ? d3.utcFormat(year ? "%b %-d, %Y" : "%b %-d")(new Date(String(iso).slice(0, 10) + "T12:00:00Z")) : "–");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MAPBASE = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json";
  const VERDICT = {
    win: { icon: "✓", label: "Model wins", short: "Win", cls: "win", color: () => css("--ours") },
    loss: { icon: "✕", label: "Official wins", short: "Loss", cls: "loss", color: () => css("--official") },
    tie: { icon: "–", label: "No significant difference", short: "Tie", cls: "tie", color: () => css("--tie") },
  };
  let S = {}, LB = [], BR = {}, LIVE = {}, SER = {}, US = null;
  let selected = null, compare = "", rangeDays = 14, filter = "all", sortKey = "mean_mw", sortDir = -1, tableAll = false;
  const TABLE_TOP = 10;

  /* ---------- tooltip ---------- */
  const tip = $("#tip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect(), pad = 14;
    let x = (ev.clientX ?? 0) + pad, y = (ev.clientY ?? 0) + pad;
    if (ev.type === "focus" && ev.target) { const b = ev.target.getBoundingClientRect(); x = b.right + pad; y = b.top; }
    if (x + r.width > innerWidth - 8) x = Math.max(8, x - r.width - 2 * pad);
    if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  const row = (label, val, color) =>
    `<div class="row"><span>${color ? `<i class="sw" style="background:${color}"></i>` : ""}${label}</span><span>${val}</span></div>`;
  const fail = (el, what) => { if (el) el.innerHTML = `<p class="load-error">Couldn't load ${what}. Please refresh the page.</p>`; };

  /* ---------- status pill + version ---------- */
  function renderStatus() {
    const pill = $("#statusPill"), txt = pill.querySelector("span");
    pill.classList.remove("ok", "stale");
    if (!LIVE || !LIVE.forecasts_issued) { txt.textContent = "Backtest results · live forecasts start at launch"; return; }
    const hours = (Date.now() - Date.parse(LIVE.updated_at.replace(" UTC", "Z").replace(" ", "T"))) / 36e5;
    const ago = hours < 1 ? "under an hour ago" : hours < 48 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} days ago`;
    if (hours <= 30) { pill.classList.add("ok"); txt.textContent = `Live · updated ${ago}`; }
    else { pill.classList.add("stale"); txt.textContent = `Last update ${ago}`; }
    pill.title = `Latest forecast published for ${fd(LIVE.latest_issued)}`;
  }
  function renderVersion() {
    const m = S.model || {}, b = S.backtest || {};
    const frozen = m.frozen_at_utc ? new Date(m.frozen_at_utc.replace("Z", ":00Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    $("#versionBadge").innerHTML =
      `<span class="badge">Model ${m.version || "v1"}${frozen ? ` · frozen ${frozen}` : ""}</span>` +
      `<span class="badge">${d3.format(",")(b.hours_scored || 0)} hours tested</span>` +
      `<a class="badge" href="changelog.html">Changelog</a>`;
  }

  /* ---------- hero ---------- */
  function renderFindings() {
    const h = S.headline, pjm = LB.find((d) => d.ba === "PJM");
    const cut = 1 - h.load_weighted_mape_blend / h.load_weighted_mape_official;
    const items = [
      pjm && pjm.verdict === "win" ? [pct(1 - pjm.mape_ours / pjm.mape_official, 0), `lower error than the operator in PJM, the largest US grid (${pct(pjm.mape_ours, 2)} vs ${pct(pjm.mape_official, 2)})`]
        : [`${h.wins}/${h.regions_fair}`, "regions where my model beats the official forecast"],
      [MINUS + pct(cut, 0), `error when operators blend my model with their own forecast (better in ${h.blend_beats_official} of ${h.regions_fair} regions)`],
      [`${h.wins}–${h.losses}`, `wins and losses across ${h.regions_fair} regions, ${h.ties} ties. The operators win more regions, and the site shows where.`],
    ];
    $("#findings").innerHTML = items.map(([b, t]) => `<li><b>${b}</b><span>${t}</span></li>`).join("");
  }
  async function renderHeroChart() {
    const el = $("#heroChart"), ba = "PJM";
    const d = await loadSeries(ba);
    if (!d) { fail(el, "the chart"); return; }
    const all = expand(d);
    const liveIdx = all.live.indexOf(true);
    const end = all.t.length, start = Math.max(0, (liveIdx >= 0 ? liveIdx : end) - 72);
    const sl = slice(all, start, end);
    const hasLive = sl.live.some(Boolean);
    $("#heroSub").textContent = `Largest US grid · last 3 days${hasLive ? " + the live forecast" : ""}`;
    $("#heroLegend").innerHTML = legendHTML(true);
    drawSeries(el, sl, ba, { animate: !reduceMotion, compact: true, label: `PJM hourly electricity demand over the last three days, with my forecast and the official forecast${hasLive ? ", plus tomorrow's live forecast" : ""}.` });
  }

  /* ---------- scoreboard ---------- */
  function renderScoreboard() {
    const h = S.headline, b = S.backtest, st = h.strict || {};
    $("#scoreTakeaway").innerHTML = `The operators win more regions, but my model wins the biggest one and has the <b>lower error where most electricity is used</b>: ${pct(h.load_weighted_mape_ours, 2)} vs ${pct(h.load_weighted_mape_official, 2)}, weighted by demand.`;
    $("#vWins").textContent = `${h.wins} of ${h.regions_fair}`;
    $("#vOf").textContent = "regions where my model beat the official forecast";
    $("#vSub").textContent = `Statistically significant after correcting for testing ${h.regions_fair} regions at once. ${h.ties} showed no significant difference, and in ${h.losses} the grid operator's forecast was better.`;
    $("#tiles").innerHTML = [
      [pct(h.load_weighted_mape_ours, 2), "my average hourly error (demand-weighted)"],
      [pct(h.load_weighted_mape_official, 2), "grid operators' average hourly error"],
      [(b.hours_scored / 1e6).toFixed(2) + "M", `region-hours scored, ${fd(b.start)} to ${fd(b.end)}`],
      [pct(h.coverage_80, 0), "of actual demand fell inside my 80% range (target: 80%)"],
    ].map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join("");
    const ex = h.excluded_suspect || [];
    const exList = ex.length > 1 ? ex.slice(0, -1).join(", ") + " and " + ex[ex.length - 1] : ex[0];
    $("#resultsSub").innerHTML = `<p>All 34 regions with at least 1,500 MW of demand and 90% data coverage were included before any scoring.` +
      (ex.length ? ` ${exList} ${ex.length > 1 ? "are" : "is"} left out of the headline because their official forecast doesn't match their reported demand (median error over 10%), which would make beating it meaningless.` : "") + `</p>` +
      (st.regions ? `<p><b>Strict check:</b> limited to the ${st.regions} regions whose official forecast is clearly genuine (median error under ${Math.round(st.threshold * 100)}%), the score is ${st.wins} wins, ${st.losses} losses and ${st.ties} ties, with a demand-weighted error of ${pct(st.load_weighted_mape_ours, 2)} for mine vs ${pct(st.load_weighted_mape_official, 2)} official.</p>` : "");
    $("#updated").textContent = `Backtest built ${S.generated_at}` + (LIVE.updated_at ? ` · live data updated ${LIVE.updated_at}` : "");
  }

  /* ---------- map ---------- */
  const visible = (d) => filter === "all" || (!d.suspect_official && d.verdict === filter);
  async function renderMap() {
    const el = $("#map");
    try { if (!US) US = await d3.json(MAPBASE); } catch (e) { fail(el, "the map"); return; }
    el.innerHTML = "";
    const svg = d3.select(el).append("svg").attr("viewBox", "0 0 975 610").attr("preserveAspectRatio", "xMidYMid meet")
      .attr("role", "group").attr("aria-label", "Map of the grid regions. Each dot is a region sized by average demand and colored by result; the same data is in the table below.");
    svg.append("g").attr("aria-hidden", "true").selectAll("path").data(topojson.feature(US, US.objects.states).features)
      .join("path").attr("class", "state").attr("d", d3.geoPath());
    const proj = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
    const r = d3.scaleSqrt().domain([0, d3.max(LB, (d) => d.mean_mw)]).range([0, 30]);
    const data = LB.filter((d) => proj([d.lon, d.lat])).sort((a, b) => b.mean_mw - a.mean_mw);
    const groups = d3.group(data, (d) => d.city);
    data.forEach((d) => {
      const [px, py] = proj([d.lon, d.lat]), g = groups.get(d.city);
      const k = g.indexOf(d), n = g.length, rad = n > 1 ? 14 : 0, a = (2 * Math.PI * k) / n - Math.PI / 2;
      d._x = px + rad * Math.cos(a); d._y = py + rad * Math.sin(a); d._r = Math.max(6, r(d.mean_mw));
    });
    svg.append("g").selectAll("circle").data(data).join("circle")
      .attr("class", (d) => "dot" + (d.ba === selected ? " sel" : "") + (visible(d) ? "" : " dim"))
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
      `<span class="key"><i class="sw" style="background:${VERDICT[k].color()}"></i>${VERDICT[k].icon} ${VERDICT[k].label} (${LB.filter((d) => !d.suspect_official && d.verdict === k).length})</span>`).join("") +
      `<span class="key"><i class="sw" style="border:1.5px dashed ${css("--muted")}"></i>Not scored (${LB.filter((d) => d.suspect_official).length})</span>`;
    const big = LB.filter((d) => !d.suspect_official).sort((a, b) => b.mean_mw - a.mean_mw).slice(0, 5);
    $("#mapTakeaway").innerHTML = `Of the five largest grids, my model wins <b>${big.filter((d) => d.verdict === "win").length}</b>, ties ${big.filter((d) => d.verdict === "tie").length} and loses ${big.filter((d) => d.verdict === "loss").length}. Hover or tab to any region for details; click to explore it.`;
  }
  function regionTip(d) {
    const v = d.suspect_official ? "Official data unreliable (not scored)" : `${VERDICT[d.verdict].icon} ${VERDICT[d.verdict].label}`;
    return `<div class="t">${d.name}</div><div style="color:${css("--ink2")};margin-bottom:6px">${d.area} · ${gw(d.mean_mw)} average</div>` +
      row("My error", pct(d.mape_ours, 2), css("--ours")) + row("Official error", pct(d.mape_official, 2), css("--official")) +
      row("Days I was closer", pct(d.win_days, 0)) + row("p-value (Holm)", d.p_holm < 0.001 ? "< 0.001" : d.p_holm.toFixed(3)) +
      `<div style="margin-top:6px;font-weight:650">${v}</div>`;
  }
  function highlight(ba, on) {
    $$(`#lb tbody tr[data-ba="${ba}"]`).forEach((tr) => tr.classList.toggle("hl", on));
    $$(`.dot[data-ba="${ba}"]`).forEach((c) => c.classList.toggle("hl", on));
  }
  function goExplore(ba) { select(ba); document.getElementById("explore").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }

  /* ---------- leaderboard ---------- */
  const COLS = [
    { k: "name", t: "Region" }, { k: "mean_mw", t: "Avg demand", num: true },
    { k: "mape_ours", t: "My error", num: true }, { k: "mape_official", t: "Official", num: true },
    { k: "improvement", t: "Difference", num: true }, { k: null, t: "Monthly trend" }, { k: "verdict", t: "Result" },
  ];
  function spark(m) {
    if (!m || m.length < 2) return "";
    const W = 96, H = 26, ys = m.flatMap((r) => [r[1], r[2]]);
    const x = d3.scaleLinear().domain([0, m.length - 1]).range([2, W - 2]);
    const y = d3.scaleLinear().domain([0, d3.max(ys) * 1.05]).range([H - 2, 2]);
    const line = (i) => d3.line().x((_, j) => x(j)).y((r) => y(r[i]))(m);
    return `<svg class="spark" width="${W}" height="${H}" role="img" aria-label="Monthly error: mine ${pct(m[m.length - 1][1], 1)}, official ${pct(m[m.length - 1][2], 1)} in the latest month">` +
      `<path d="${line(2)}" fill="none" stroke="${css("--official")}" stroke-width="1.5"/><path d="${line(1)}" fill="none" stroke="${css("--ours")}" stroke-width="1.5"/></svg>`;
  }
  function renderTable() {
    const show = $("#showSuspect").checked;
    const rows = LB.filter((d) => (show || !d.suspect_official) && visible(d)).slice().sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir;
    });
    const total = rows.length;
    if (!tableAll && total > TABLE_TOP + 2) rows.splice(TABLE_TOP);
    const more = $("#lbMore");
    more.hidden = total <= TABLE_TOP + 2;
    more.textContent = tableAll ? "Show the first 10 only" : `Show all ${total} regions`;
    more.setAttribute("aria-expanded", String(tableAll));
    const maxImp = Math.min(0.6, d3.max(LB.filter((d) => !d.suspect_official), (d) => Math.abs(d.improvement)) || 0.1);
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
  function setFilter(f) {
    filter = f;
    $$("#filters .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === f)));
    d3.selectAll(".dot").classed("dim", (d) => !visible(d));
    d3.selectAll(".maplabel").classed("dim", (d) => !visible(d));
    renderTable();
  }

  /* ---------- series helpers ---------- */
  async function loadSeries(ba) {
    if (!(ba in SER)) SER[ba] = await fetch(`data/series/${ba}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return SER[ba];
  }
  function expand(d) {
    const t0 = Date.parse(d.t0.replace("Z", ":00Z"));
    const t = d.actual.map((_, i) => new Date(t0 + i * 36e5));
    return { t, actual: d.actual, official: d.official, p10: d.p10, p50: d.p50, p90: d.p90,
             live: t.map((_, i) => d.live_from != null && i >= d.live_from) };
  }
  function slice(s, a, b) { const o = {}; for (const k in s) o[k] = s[k].slice(a, b); return o; }
  function lastDays(s, days) {
    const liveIdx = s.live.indexOf(true), end = s.t.length, histEnd = liveIdx >= 0 ? liveIdx : end;
    return slice(s, Math.max(0, histEnd - days * 24), end);
  }
  const legendHTML = (compact) =>
    `<span class="key"><i class="sw line" style="background:${css("--actual")}"></i>Actual</span>` +
    `<span class="key"><i class="sw line" style="background:${css("--ours")}"></i>My forecast</span>` +
    `<span class="key"><i class="sw band"></i>My 80% range</span>` +
    `<span class="key"><i class="sw line" style="background:${css("--official")}"></i>Official${compact ? "" : " day-ahead forecast"}</span>`;

  /* ---------- generic line chart with crosshair ---------- */
  function lineChart(el, o) {
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
  function drawSeries(el, s, ba, opt = {}) {
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
  function statsHTML(s, ba) {
    const meta = LB.find((r) => r.ba === ba);
    let eo = [], ef = [];
    s.actual.forEach((a, i) => { if (a > 0 && s.p50[i] != null && s.official[i] > 0) { eo.push(Math.abs(s.p50[i] - a) / a); ef.push(Math.abs(s.official[i] - a) / a); } });
    if (!meta) return "";
    return [[pct(d3.mean(eo), 2), `my error, last ${rangeDays} days`], [pct(d3.mean(ef), 2), `official error, last ${rangeDays} days`],
      [meta.suspect_official ? "Not scored" : `${VERDICT[meta.verdict].icon} ${VERDICT[meta.verdict].label}`, `full backtest since ${fd(S.backtest.start)}`],
    ].map(([v, l]) => `<div><b>${v}</b><br>${l}</div>`).join("");
  }

  /* ---------- explorer ---------- */
  function select(ba) {
    selected = ba; $("#regionSel").value = ba;
    d3.selectAll(".dot").classed("sel", (d) => d.ba === ba);
    renderExplorer();
  }
  async function renderExplorer() {
    const want = selected, el = $("#seriesChart");
    const d = await loadSeries(want);
    if (want !== selected) return;
    if (!d) { fail(el, "this region's data"); return; }
    const s = lastDays(expand(d), rangeDays), meta = LB.find((r) => r.ba === want) || {};
    $("#seriesLegend").innerHTML = legendHTML(false);
    $("#regionStats").innerHTML = statsHTML(s, want);
    drawSeries(el, s, want, { label: `Hourly electricity demand in ${meta.name || want} over the last ${rangeDays} days: actual demand, my forecast with its 80% range, and the official day-ahead forecast.` });
    renderWhy();
    renderCompare();
  }
  async function renderCompare() {
    const wrap = $("#compareWrap");
    if (!compare || compare === selected) { wrap.hidden = true; return; }
    const want = compare, d = await loadSeries(want);
    if (want !== compare) return;
    wrap.hidden = false;
    const meta = LB.find((r) => r.ba === want) || {};
    $("#compareTitle").textContent = `${meta.name || want} (${meta.area || ""})`;
    if (!d) { fail($("#compareChart"), "this region's data"); return; }
    const s = lastDays(expand(d), rangeDays);
    $("#compareStats").innerHTML = statsHTML(s, want);
    drawSeries($("#compareChart"), s, want, { label: `Comparison: hourly demand in ${meta.name || want} over the last ${rangeDays} days.` });
  }
  function downloadCSV() {
    const d = SER[selected]; if (!d) return;
    const s = lastDays(expand(d), rangeDays), tz = (window.REGION_TZ || {})[selected];
    const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const lines = ["hour_ending_utc,hour_ending_local,actual_mw,official_forecast_mw,my_forecast_mw,my_p10_mw,my_p90_mw,is_live_forecast"];
    s.t.forEach((t, i) => lines.push([t.toISOString(), fmt.format(t), s.actual[i] ?? "", s.official[i] ?? "", s.p50[i] ?? "", s.p10[i] ?? "", s.p90[i] ?? "", s.live[i]].join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `beat-the-grid_${selected}_last${rangeDays}days.csv` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- plain-language definitions for the jargon (first use in each section) ---------- */
  const GLOSSARY = [
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
  const SKIP = "a,button,select,option,svg,h1,h2,h3,label,summary,.term,.tip,.ticker,table,.kicker,.eyebrow,script,style,code,pre,.sql-card";
  function glossify(scope) {
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
  function glossifyNode(node, seen) {           // keep scanning the remainder of a split text node
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
  function bindGlossary() {
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

  /* ---------- shareable explorer views: #explore?region=ERCO&days=30&compare=PJM ---------- */
  function viewFromHash() {
    const q = location.hash.split("?")[1];
    if (!q || !location.hash.startsWith("#explore")) return;
    const sp = new URLSearchParams(q), ba = sp.get("region"), cmp = sp.get("compare"), d = +sp.get("days");
    if (ba && LB.some((r) => r.ba === ba)) selected = ba;
    if ([7, 14, 30].includes(d)) { rangeDays = d; $$("#rangeSeg button").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.d === d))); }
    if (cmp && LB.some((r) => r.ba === cmp)) { compare = cmp; $("#compareSel").value = cmp; }
  }
  function viewLink() {
    const sp = new URLSearchParams({ region: selected, days: rangeDays });
    if (compare) sp.set("compare", compare);
    return `${location.origin}${location.pathname}#explore?${sp}`;
  }
  const syncView = () => { try { history.replaceState(null, "", "#explore?" + viewLink().split("#explore?")[1]); } catch (e) { /* file:// */ } };
  async function copyText(text, btn, done) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = Object.assign(document.createElement("textarea"), { value: text }); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); try { ok = document.execCommand("copy"); } catch (e2) { ok = false; } ta.remove();
    }
    const label = btn.textContent; btn.textContent = ok ? done : "Couldn't copy"; setTimeout(() => { btn.textContent = label; }, 1800);
  }

  /* ---------- "Find your grid": a state picker that jumps to the region serving most of that state ---------- */
  const STATE_BA = {
    Alabama: "SOCO", Arizona: "AZPS", Arkansas: "MISO", California: "CISO", Colorado: "PSCO", Connecticut: "ISNE", Delaware: "PJM",
    "District of Columbia": "PJM", Florida: "FPL", Georgia: "SOCO", Idaho: "IPCO", Illinois: "PJM", Indiana: "MISO", Iowa: "MISO",
    Kansas: "SWPP", Kentucky: "LGEE", Louisiana: "MISO", Maine: "ISNE", Maryland: "PJM", Massachusetts: "ISNE", Michigan: "MISO",
    Minnesota: "MISO", Mississippi: "MISO", Missouri: "MISO", Nebraska: "SWPP", Nevada: "NEVP", "New Hampshire": "ISNE",
    "New Jersey": "PJM", "New Mexico": "PNM", "New York": "NYIS", "North Carolina": "DUK", "North Dakota": "MISO", Ohio: "PJM",
    Oklahoma: "SWPP", Oregon: "PGE", Pennsylvania: "PJM", "Rhode Island": "ISNE", "South Carolina": "SCEG", "South Dakota": "SWPP",
    Tennessee: "TVA", Texas: "ERCO", Utah: "PACE", Vermont: "ISNE", Virginia: "PJM", Washington: "PSEI", "West Virginia": "PJM",
    Wisconsin: "MISO", Wyoming: "PACE", Montana: null, Alaska: null, Hawaii: null,
  };
  const storeGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  function findGridText(state, ba) {
    if (!ba) return state === "Montana"
      ? "Montana's main grid operator, NorthWestern Energy, isn't one of the 34 regions in the contest."
      : `${state} runs its own electric grid, separate from the mainland regions in this contest.`;
    const d = LB.find((r) => r.ba === ba) || {};
    const how = d.suspect_official ? "its official forecast data looked unreliable, so it isn't scored in the contest"
      : d.verdict === "win" ? `my model beat the operator's own forecast there in the backtest (${pct(d.mape_ours, 2)} vs ${pct(d.mape_official, 2)} average error)`
      : d.verdict === "loss" ? `the operator's own forecast beat my model there (${pct(d.mape_official, 2)} vs my ${pct(d.mape_ours, 2)})`
      : `my model and the operator were statistically tied there (${pct(d.mape_ours, 2)} vs ${pct(d.mape_official, 2)})`;
    return `Most of ${state} is served by <b>${d.name || ba}</b>, and ${how}. The charts below now show your grid.`;
  }
  function chooseState(state, quiet) {
    const ba = STATE_BA[state];
    $("#findOut").innerHTML = state ? findGridText(state, ba) : "";
    storeSet("btg-state", state || "");
    if (!ba) return;
    select(ba);
    if (game.init && !game.revealed && game.ba !== ba && GAME_LIST().includes(ba)) { $("#gameRegion").value = ba; newGame(ba); }
    if (!quiet) document.getElementById("explore").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
  function renderFindGrid() {
    const sel = $("#stateSel");
    sel.innerHTML = `<option value="">Pick your state</option>` + Object.keys(STATE_BA).sort().map((st) => `<option>${st}</option>`).join("");
    sel.addEventListener("change", () => chooseState(sel.value, true));
    const saved = storeGet("btg-state");
    if (saved && saved in STATE_BA) { sel.value = saved; $("#findOut").innerHTML = findGridText(saved, STATE_BA[saved]); }
  }
  const savedBA = () => { const st = storeGet("btg-state"); return st && STATE_BA[st] ? STATE_BA[st] : null; };

  /* ---------- "Can you beat the model?": draw the next 24 hours, then compare with my model and the operator ---------- */
  const GAME_LIST = () => LB.filter((d) => !d.suspect_official).sort((a, b) => b.mean_mw - a.mean_mw).map((d) => d.ba);
  const game = { ba: "PJM", s: null, day: null, guess: null, revealed: false, used: new Set(), cur: 0, kb: false };
  const gameRecord = () => { try { return JSON.parse(localStorage.getItem("btg-game") || "{}"); } catch (e) { return {}; } };
  function saveRecord(r) { try { localStorage.setItem("btg-game", JSON.stringify(r)); } catch (e) { /* private mode: no record */ } }
  function showRecord() {
    const r = gameRecord();
    $("#gameRecord").textContent = r.played ? `Your record: ${r.played} day${r.played > 1 ? "s" : ""} played, beat my model ${r.beatMine || 0}, beat the operator ${r.beatOfficial || 0}` : "";
  }
  // Complete local days (midnight to midnight in the region's time zone) with actual, official and my forecast for all
  // 24 hours, three full days of history before them, and nothing from the live forecast.
  function gameDays(s, tz) {
    const hourOf = (t) => +new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date(+t - 36e5));
    const days = [];
    for (let i = 72; i + 24 <= s.t.length; i++) {
      if (hourOf(s.t[i]) !== 0) continue;
      let ok = true;
      for (let j = i - 72; j < i + 24 && ok; j++) ok = s.actual[j] != null && !s.live[j] && (j < i || (s.official[j] != null && s.p50[j] != null));
      if (ok) days.push(i);
    }
    return days;
  }
  async function newGame(ba) {
    game.ba = ba || game.ba;
    const raw = await loadSeries(game.ba), el = $("#gameChart");
    if (!raw) { fail(el, "this region"); return; }
    game.s = expand(raw);
    const tz = (window.REGION_TZ || {})[game.ba];
    let days = gameDays(game.s, tz);
    const fresh = days.filter((i) => !game.used.has(game.ba + i));
    if (!days.length) { el.innerHTML = `<p class="load-error">No complete day to play in this region right now.</p>`; return; }
    if (fresh.length) days = fresh; else game.used.clear();
    game.day = days[Math.floor(Math.random() * days.length)];
    game.used.add(game.ba + game.day);
    game.guess = new Array(24).fill(null);
    game.revealed = false; game.cur = 0; game.kb = false;
    const start = new Date(+game.s.t[game.day] - 36e5);
    $("#gameDay").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: tz }).format(start);
    $("#gameResult").innerHTML = "";
    $("#gameReveal").disabled = true;
    $("#gameReveal").hidden = false;
    $("#gameHint").textContent = "Drag across the shaded day to draw your forecast. You can redraw any part.";
    drawGame();
  }
  function drawGame() {
    const el = $("#gameChart"), s = game.s, C = (el.clientWidth || 700) < 560 ? 24 : 72;   // phones: one day of history, so the day to draw is wide enough
    const d0 = game.day - C, d1 = game.day + 24;
    const tz = (window.REGION_TZ || {})[game.ba];
    el.innerHTML = "";
    const W = el.clientWidth || 700, H = el.clientHeight || 340, m = { t: 26, r: 14, b: 30, l: 54 };
    const idx = d3.range(d0, d1);
    const ctx = idx.slice(0, C).map((i) => s.actual[i]);
    const seen = game.revealed ? idx.slice(C).flatMap((i) => [s.actual[i], s.official[i], s.p50[i]]) : [];
    const mine = game.guess.filter((v) => v != null);
    const lo = d3.min([...ctx, ...seen, ...mine]), hi = d3.max([...ctx, ...seen, ...mine]), span = hi - lo;
    const y = d3.scaleLinear().domain([lo - span * 0.25, hi + span * 0.25]).nice().range([H - m.b, m.t]);
    const x = d3.scaleLinear().domain([d0, d1 - 1]).range([m.l, W - m.r]);
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", `${C / 24 === 1 ? "A day" : "Three days"} of ${game.ba} demand, then the day to forecast`);
    svg.append("rect").attr("x", x(game.day - 0.5)).attr("width", x(d1 - 1) - x(game.day - 0.5)).attr("y", m.t).attr("height", H - m.t - m.b).attr("fill", css("--live"));
    svg.append("text").attr("class", "lbl anno").attr("text-anchor", "end").attr("x", x(d1 - 1)).attr("y", m.t - 8).text(game.revealed ? "how it went" : "your forecast goes here");
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => d3.format(",.0f")(v / 1000) + " GW"));
    const dayTicks = idx.filter((i) => +new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date(+s.t[i] - 36e5)) === 0);
    const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz });
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(dayTicks).tickFormat((i) => fmt.format(new Date(+s.t[i] - 36e5))));
    const line = (vals, from) => d3.line().defined((v) => v != null).x((v, k) => x(from + k)).y((v) => y(v)).curve(d3.curveMonotoneX)(vals);
    svg.append("path").attr("d", line(ctx, d0)).attr("fill", "none").attr("stroke", css("--actual")).attr("stroke-width", 2);
    if (game.revealed) {
      const tgt = (k) => idx.slice(C).map((i) => s[k][i]);
      [["official", css("--official"), 2], ["p50", css("--ours"), 2.2], ["actual", css("--actual"), 2.6]].forEach(([k, c, w]) => {
        const p = svg.append("path").attr("d", line(tgt(k), game.day)).attr("fill", "none").attr("stroke", c).attr("stroke-width", w);
        if (!reduceMotion) { const L = p.node().getTotalLength(); p.attr("stroke-dasharray", L).attr("stroke-dashoffset", L).transition().duration(900).attr("stroke-dashoffset", 0); }
      });
    }
    // the visitor's forecast, in the logo's violet
    svg.append("path").attr("class", "guess").attr("d", line(game.guess, game.day)).attr("fill", "none").attr("stroke", "var(--you)").attr("stroke-width", 3).attr("stroke-linecap", "round");
    svg.selectAll("circle.g").data(game.guess.map((v, k) => [v, k]).filter((p) => p[0] != null)).join("circle").attr("class", "g")
      .attr("cx", (p) => x(game.day + p[1])).attr("cy", (p) => y(p[0])).attr("r", 2.5).attr("fill", "var(--you)");
    game.y = y;
    if (game.kb && !game.revealed) {
      const cx = x(game.day + game.cur), v = game.guess[game.cur];
      svg.append("line").attr("x1", cx).attr("x2", cx).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", "var(--you)").attr("stroke-dasharray", "3 3");
      if (v != null) svg.append("circle").attr("cx", cx).attr("cy", y(v)).attr("r", 6).attr("fill", "none").attr("stroke", "var(--you)").attr("stroke-width", 2);
    }
    if (game.revealed) return;
    // drawing surface over the target day
    const pad = svg.append("rect").attr("class", "game-pad").attr("x", x(game.day - 0.5)).attr("width", x(d1 - 1) - x(game.day - 0.5) + m.r)
      .attr("y", 0).attr("height", H).attr("fill", "transparent");
    let last = null;
    const put = (ev) => {
      const [px, py] = d3.pointer(ev, svg.node());
      const k = Math.max(0, Math.min(23, Math.round(x.invert(px) - game.day))), v = Math.max(y.domain()[0], Math.min(y.domain()[1], y.invert(py)));
      if (last && last.k !== k) {                                       // fill hours skipped by a fast stroke
        const step = k > last.k ? 1 : -1;
        for (let j = last.k + step; j !== k; j += step) game.guess[j] = last.v + (v - last.v) * (j - last.k) / (k - last.k);
      }
      game.guess[k] = v; last = { k, v };
      svg.select("path.guess").attr("d", line(game.guess, game.day));
      svg.selectAll("circle.g").data(game.guess.map((g, j) => [g, j]).filter((p) => p[0] != null)).join("circle").attr("class", "g")
        .attr("cx", (p) => x(game.day + p[1])).attr("cy", (p) => y(p[0])).attr("r", 2.5).attr("fill", "var(--you)");
      const n = game.guess.filter((g) => g != null).length;
      $("#gameReveal").disabled = n < 18;
      $("#gameHint").textContent = n < 18 ? `${n} of 24 hours drawn. Draw at least 18 (gaps are filled in for you).` : "Ready. Redraw any part, or reveal what happened.";
    };
    pad.on("pointerdown", (ev) => { ev.preventDefault(); pad.node().setPointerCapture(ev.pointerId); last = null; put(ev); })
      .on("pointermove", (ev) => { if (ev.buttons || ev.pointerType === "touch") { if (pad.node().hasPointerCapture(ev.pointerId)) put(ev); } })
      .on("pointerup pointercancel", () => { last = null; });
  }
  function fillGaps(g) {
    const known = g.map((v, k) => [k, v]).filter((p) => p[1] != null);
    return g.map((v, k) => {
      if (v != null) return v;
      const a = known.filter((p) => p[0] < k).pop(), b = known.find((p) => p[0] > k);
      return a && b ? a[1] + (b[1] - a[1]) * (k - a[0]) / (b[0] - a[0]) : (a || b)[1];
    });
  }
  function reveal() {
    const s = game.s, idx = d3.range(game.day, game.day + 24);
    game.guess = fillGaps(game.guess);
    game.revealed = true;
    const err = (vals) => d3.mean(idx, (i, k) => Math.abs(vals[k] - s.actual[i]) / s.actual[i]);
    const you = err(game.guess), mine = err(idx.map((i) => s.p50[i])), off = err(idx.map((i) => s.official[i]));
    const beatMine = you < mine, beatOff = you < off;
    const verdict = beatMine && beatOff ? "You beat both. That's a better forecast than a grid operator's, made in a few seconds."
      : beatOff ? "You beat the grid operator! My model still did better."
      : beatMine ? "You beat my model, but not the grid operator."
      : "The forecasters win this one. Try another day.";
    const r = gameRecord();
    saveRecord({ played: (r.played || 0) + 1, beatMine: (r.beatMine || 0) + (beatMine ? 1 : 0), beatOfficial: (r.beatOfficial || 0) + (beatOff ? 1 : 0) });
    showRecord();
    const score = (label, v, cls) => `<div class="game-score ${cls}"><b>${pct(v, 1)}</b><span>${label}</span></div>`;
    $("#gameResult").innerHTML = `<p class="game-verdict">${verdict}</p><div class="game-scores">` +
      score("your error", you, "you") + score("my model", mine, "mine") + score("grid operator", off, "off") + `</div>` +
      `<p class="game-share"><button type="button" class="ghost" id="gameShare">Share my score</button></p>` +
      `<p class="note">Average error over the 24 hours. My model only knew demand up to 06:00 UTC the day before, plus a weather forecast; you saw the days before it.</p>`;
    const region = (LB.find((d) => d.ba === game.ba) || {}).name || game.ba, dayName = $("#gameDay").textContent;
    const brag = beatMine && beatOff ? `I beat both a machine-learning model and the grid operator` : beatOff ? `I beat the grid operator` : beatMine ? `I beat the machine-learning model` : `I tried to out-forecast the grid`;
    const share = `${brag} forecasting electricity demand for ${region} on ${dayName}: my error ${pct(you, 1)}, the model ${pct(mine, 1)}, the operator ${pct(off, 1)}. Can you do better?`;
    $("#gameShare").addEventListener("click", async (e) => {
      const url = `${location.origin}${location.pathname}#game`;
      if (navigator.share && matchMedia("(pointer: coarse)").matches) { try { await navigator.share({ title: "Beat the Grid", text: share, url }); return; } catch (err) { /* cancelled */ } }
      copyText(`${share} ${url}`, e.currentTarget, "Copied, paste it anywhere");
    });
    $("#gameReveal").hidden = true;
    $("#gameHint").textContent = "The line that continues the history is what actually happened. Try another day or another region.";
    drawGame();
  }
  function renderGame() {
    const sel = $("#gameRegion");
    sel.innerHTML = GAME_LIST().map((ba) => { const m = LB.find((d) => d.ba === ba) || {}; return `<option value="${ba}">${m.name || ba}</option>`; }).join("");
    $("#gameLegend").innerHTML = `<span class="key"><i class="sw line" style="background:var(--you)"></i>Your forecast</span>` +
      `<span class="key"><i class="sw line" style="background:${css("--actual")}"></i>Actual</span>` +
      `<span class="key"><i class="sw line" style="background:${css("--ours")}"></i>My model</span>` +
      `<span class="key"><i class="sw line" style="background:${css("--official")}"></i>Grid operator</span>`;
    sel.addEventListener("change", () => newGame(sel.value));
    $("#gameNew").addEventListener("click", () => newGame());
    $("#gameReveal").addEventListener("click", reveal);
    const chart = $("#gameChart");
    chart.tabIndex = 0;
    chart.setAttribute("role", "application");
    chart.setAttribute("aria-roledescription", "forecast drawing");
    chart.setAttribute("aria-label", "Draw your forecast. Left and right arrows pick an hour, up and down arrows change it, hold Shift for bigger steps.");
    chart.addEventListener("keydown", (e) => {
      if (game.revealed || !game.s || !game.y) return;
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      game.kb = true;
      const [lo, hi] = game.y.domain(), step = (hi - lo) * (e.shiftKey ? 0.05 : 0.01);
      const seed = () => game.guess[game.cur] ?? game.guess[game.cur - 1] ?? game.s.actual[game.day - 1];
      if (e.key === "ArrowLeft") game.cur = Math.max(0, game.cur - 1);
      if (e.key === "ArrowRight") { const prev = game.guess[game.cur]; game.cur = Math.min(23, game.cur + 1); if (game.guess[game.cur] == null && prev != null) game.guess[game.cur] = prev; }
      if (e.key === "Home") game.cur = 0;
      if (e.key === "End") game.cur = 23;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") game.guess[game.cur] = Math.max(lo, Math.min(hi, seed() + (e.key === "ArrowUp" ? step : -step)));
      if (game.guess[game.cur] == null) game.guess[game.cur] = seed();
      const n = game.guess.filter((g) => g != null).length, tz = (window.REGION_TZ || {})[game.ba];
      const when = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: tz }).format(new Date(+game.s.t[game.day + game.cur] - 36e5));
      $("#gameReveal").disabled = n < 18;
      $("#gameHint").textContent = `${when}: ${gw(game.guess[game.cur])}. ${n} of 24 hours set${n < 18 ? " (set at least 18)" : ", ready to reveal"}.`;
      drawGame();
    });
    chart.addEventListener("blur", () => { if (game.kb) { game.kb = false; if (game.s) drawGame(); } });
    $("#gameHelp").addEventListener("click", () => {
      if (game.revealed || !game.s) return;
      game.guess = d3.range(24).map((k) => game.s.actual[game.day - 24 + k]);
      $("#gameReveal").disabled = false;
      $("#gameHint").textContent = "Filled with the day before. Drag to adjust any hours, then reveal.";
      drawGame();
    });
    showRecord();
    const start = GAME_LIST().includes(savedBA()) ? savedBA() : "PJM";
    sel.value = start;
    newGame(start);
  }

  /* ---------- live ticker: tomorrow's forecast for every region, scrolling under a pause button ---------- */
  function renderTicker() {
    const el = $("#ticker"), W = window.WHY;
    if (!el || !W || !W.target || !W.regions || !Object.keys(W.regions).length) return;
    const hr = (h) => (h === 0 ? "12 am" : h < 12 ? h + " am" : h === 12 ? "12 pm" : h - 12 + " pm");
    const rows = Object.entries(W.regions).sort((a, b) => b[1].avg_mw - a[1].avg_mw);
    const item = ([ba, r]) => {
      const v = r.vs_last_week, cls = v >= 0 ? "up" : "dn";
      return `<a class="tk-item" href="#explore" data-ba="${ba}"><b>${ba}</b> ${gw(r.avg_mw)} avg · peak ${gw(r.peak_mw)} at ${hr(r.peak_hour)} ` +
        `<span class="${cls}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v * 100).toFixed(1)}%</span></a>`;
    };
    const list = rows.map(item).join("");
    const day = d3.utcFormat("%a %b %-d")(new Date(W.target + "T12:00:00Z"));
    el.innerHTML = `<span class="tk-label">${relDay(W.target) || "Live forecast"}<span class="tk-day"> · ${day}</span></span>` +
      `<div class="tk-view"><div class="tk-track" style="--tk-dur:${Math.max(40, rows.length * 4)}s"><div class="tk-set">${list}</div><div class="tk-set" aria-hidden="true">${list.replace(/<a /g, '<a tabindex="-1" ')}</div></div></div>` +
      `<button type="button" class="tk-pause" aria-pressed="false" aria-label="Pause the ticker">❚❚</button>`;
    el.hidden = false;
    const btn = el.querySelector(".tk-pause");
    btn.addEventListener("click", () => { const on = el.classList.toggle("paused"); btn.setAttribute("aria-pressed", String(on)); btn.textContent = on ? "▶" : "❚❚"; btn.setAttribute("aria-label", on ? "Play the ticker" : "Pause the ticker"); });
    el.querySelectorAll("a[data-ba]").forEach((a) => a.addEventListener("click", () => { select(a.dataset.ba); $("#regionSel").value = a.dataset.ba; }));
  }

  /* ---------- tomorrow: why ---------- */
  function renderWhy() {
    const el = $("#whyCard"), W = window.WHY, r = W && W.regions && W.regions[selected];
    if (!r) { el.hidden = true; return; }
    el.hidden = false;
    const hr = (h) => (h === 0 ? "midnight" : h < 12 ? h + " am" : h === 12 ? "noon" : h - 12 + " pm");
    const max = d3.max(Object.values(r.drivers), Math.abs) || 0.01;
    const sign = (v) => (v >= 0 ? "+" : MINUS) + Math.abs(v * 100).toFixed(1) + "%";
    const dT = r.temp_vs_last_week_c;
    el.innerHTML = `<h3>${[relDay(W.target), d3.utcFormat("%A %b %-d")(new Date(W.target + "T12:00:00Z"))].filter(Boolean).join(", ")} <span class="live-tag">Live forecast</span></h3><div class="facts">` +
      `<span>Average <b>${gw(r.avg_mw)}</b> (${sign(r.vs_last_week)} vs last week)</span>` +
      `<span>Peak <b>${gw(r.peak_mw)}</b> around ${hr(r.peak_hour)}</span>` +
      (r.max_temp_c == null ? "" : `<span>Hottest hour <b>${r.max_temp_c.toFixed(0)}°C / ${(r.max_temp_c * 9 / 5 + 32).toFixed(0)}°F</b>${dT == null ? "" : ` (${dT >= 0 ? "+" : MINUS}${Math.abs(dT).toFixed(1)}°C vs a week earlier)`}</span>`) + `</div>` +
      `<div class="cap" style="margin:0 0 4px">What pushed the forecast up or down, as a share of last week's average:</div>` +
      Object.entries(r.drivers).map(([k, v]) => {
        const w = Math.abs(v) / max * 50;
        return `<div class="drv"><span>${k}</span><span class="bar"><i style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:${v >= 0 ? css("--ours") : css("--tie")}"></i></span><span>${sign(v)}</span></div>`;
      }).join("");
  }

  /* ---------- when we win ---------- */
  function renderWhen() {
    const ser = (rows, key) => rows.map((r) => r[key]);
    const H = BR.by_hour || [], M = BR.by_month || [];
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
    const D = (BR.by_daytype || []).slice().sort((a, b) => order(a.day_type) - order(b.day_type));
    if (D.length) renderDayBars(D);
  }
  const order = (t) => (t.startsWith("Busiest") ? 0 : t.startsWith("All") ? 1 : 2);
  function renderDayBars(D) {
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
  function renderPeaks() {
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
  function renderBlend() {
    const h = S.headline, B = window.BLEND || {}, V = window.VALUE || {};
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
    const rows = LB.filter((d) => !d.suspect_official && W[d.ba]).sort((a, b) => b.mean_mw - a.mean_mw);
    const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    const ramp = d3.interpolateRgb(dark ? "#1d2a3a" : "#e7f0fc", dark ? "#6da7ec" : "#1c5cab");
    const ink = (w) => (dark ? (w > 0.6 ? "#0b0b0b" : "#f0efec") : (w > 0.5 ? "#ffffff" : "#0b0b0b"));
    $("#blendTable").innerHTML = `<caption class="sr-only">Blend weights by region and time of day</caption><thead><tr><th>Region</th>${Object.values(parts).map((p) => `<th class="num">${p}</th>`).join("")}</tr></thead><tbody>` +
      rows.map((d) => `<tr><td class="reg"><b>${d.name}</b><span>${d.ba}</span></td>` +
        Object.keys(parts).map((k) => { const w = W[d.ba][k]; return `<td class="w" style="background:${ramp(w)};color:${ink(w)}" title="${d.name}, ${parts[k]}: ${Math.round(w * 100)}% my model">${Math.round(w * 100)}%</td>`; }).join("") + `</tr>`).join("") + `</tbody>`;
    const t = V.totals;
    $("#valueNote").innerHTML = (t ? `<p>Over a year, the official forecasts in these regions mis-forecast about <b>${d3.format(",.0f")(t.gwh_official / 1000)} TWh</b> of electricity; the blend, <b>${d3.format(",.0f")(t.gwh_blend / 1000)} TWh</b>. At average 2026 wholesale prices that energy is worth about <b>$${(t.usd_official / 1e9).toFixed(1)} billion</b> versus <b>$${(t.usd_blend / 1e9).toFixed(1)} billion</b> a year. That's an illustration of scale, not a cost estimate: the real cost of forecast errors depends on reserves and balancing markets and is a fraction of the energy's value. Prices: ${V.price_source}.</p>` : "") +
      `<p>How it was tested: for each quarter, the weights were learned only from earlier quarters, where my forecasts were themselves out-of-sample. The first quarter used a plain 50/50 average. This answers a different question from the contest (the operator's forecast may be published after my issue time): how much would an operator gain by adding my model to its own?</p>`;
  }

  /* ---------- misses ---------- */
  function renderMisses() {
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

  /* ---------- live ---------- */
  function voidNote(L) {
    const v = (L && L.voided) || [];
    return v.length ? `<details class="more"><summary>${v.length} voided forecast${v.length > 1 ? "s" : ""}</summary>` +
      v.map((d) => `<p><b>${fd(d.date)}</b>, voided ${fd(d.voided_at_utc, false)} at ${d.voided_at_utc.slice(11, 16)} UTC, before the day began: ${d.reason}</p>`).join("") + `</details>` : "";
  }
  function renderLive() {
    const el = $("#liveCard"), L = LIVE;
    if (!L || !L.forecasts_issued) {
      el.innerHTML = `<p style="margin:0">The live record begins on launch day. From then on, every forecast appears in <a href="https://github.com/MaxListon/beat-the-grid/tree/main/forecasts">forecasts/</a> with the time it was committed, and each finished day is scored here automatically.</p>` + voidNote(L);
      return;
    }
    const head = `<div class="live-grid">` +
      `<div class="tile"><b>${L.forecasts_issued}</b><span>daily forecast${L.forecasts_issued === 1 ? "" : "s"} published${L.latest_issued ? `, latest for ${fd(L.latest_issued, false)}` : ""}</span></div>` +
      `<div class="tile"><b>${L.days || 0}</b><span>days scored so far</span></div>` +
      `<div class="tile"><b>${L.start_date ? fd(L.start_date, false) : "–"}</b><span>first scored day</span></div></div>`;
    if (!L.days) { el.innerHTML = head + `<p class="cap">Scores appear once EIA has reported the whole day, usually about two days later.</p>` + voidNote(L); return; }
    const rows = L.regions.slice().sort((a, b) => (b.mape_official - b.mape_ours) - (a.mape_official - a.mape_ours));
    const won = rows.filter((r) => r.mape_ours < r.mape_official).length;
    el.innerHTML = head + weekHTML(L.week) + calendarHTML(L.by_day || []) + (L.expect && (L.by_day || []).length ? `<div class="expect" id="expectChart"></div>` : "") + `<p class="cap">So far my error is lower in <b>${won} of ${rows.length}</b> regions over ${L.days} live day${L.days > 1 ? "s" : ""}. With only a few weeks of data these numbers are noisy; the backtest is the stronger evidence until the live record grows.</p>` +
      `<div class="table-wrap"><table class="lb live-lb" id="liveTable"><thead><tr><th>Region</th><th class="num">Days</th><th class="num">My error</th><th class="num">Official</th><th class="num">Days I was closer</th></tr></thead><tbody>` +
      rows.map((r, i) => { const meta = LB.find((x) => x.ba === r.ba) || {}; return `<tr data-ba="${r.ba}" tabindex="0"${i >= 10 ? ' class="extra"' : ""}><td class="reg"><b>${meta.name || r.ba}</b><span>${r.ba}</span></td><td class="num" data-label="Days">${r.days}</td><td class="num" data-label="My error">${pct(r.mape_ours, 2)}</td><td class="num" data-label="Official">${pct(r.mape_official, 2)}</td><td class="num" data-label="Days closer">${r.days_won} of ${r.days}</td></tr>`; }).join("") +
      `</tbody></table></div>` +
      (rows.length > 12 ? `<button type="button" class="ghost" id="liveMore" aria-expanded="false" aria-controls="liveTable">Show all ${rows.length} regions</button>` : "") + voidNote(L);
    bindCalendar(el, L.by_day || []);
    const lm = $("#liveMore");
    if (lm) lm.addEventListener("click", () => { const all = $("#liveTable").classList.toggle("all"); lm.textContent = all ? "Show the first 10 only" : `Show all ${rows.length} regions`; lm.setAttribute("aria-expanded", String(all)); });
    if ($("#expectChart")) drawExpect($("#expectChart"), L.by_day, L.expect);
    el.querySelectorAll("tr[data-ba]").forEach((tr) => { tr.addEventListener("click", () => goExplore(tr.dataset.ba)); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") goExplore(tr.dataset.ba); }); });
  }

  /* "This week": the last seven scored days in a few plain sentences (built by site_data.weekly_summary) */
  function weekHTML(w) {
    if (!w) return "";
    const nm = (ba) => (LB.find((x) => x.ba === ba) || {}).name || ba;
    const day = (d) => d3.utcFormat("%b %-d")(new Date(d + "T12:00:00Z"));
    const won = w.mape_ours < w.mape_official, t = w.worst.temp_vs_last_week_c;
    const weather = t == null || Math.abs(t) < 3 ? "" : `, a day forecast to be ${Math.abs(t).toFixed(0)}°C ${t < 0 ? "colder" : "warmer"} than the week before`;
    return `<div class="week"><h3>This week <span>${day(w.start)} – ${day(w.end)}</span></h3><p>` +
      `${won ? "My model came out ahead" : "The operators came out ahead"}: <b>${pct(w.mape_ours, 2)}</b> average error vs <b>${pct(w.mape_official, 2)}</b> official. ` +
      `It was closer on <b>${w.days_won} of ${w.days}</b> days and in <b>${w.regions_won} of ${w.regions}</b> regions.</p><p>` +
      `Best region: <b>${nm(w.best.ba)}</b>, ${pct(w.best.mape_ours, 1)} vs ${pct(w.best.mape_official, 1)}. ` +
      `Biggest miss: <b>${nm(w.worst.ba)}</b> on ${day(w.worst.date)}, ${pct(w.worst.mape_ours, 1)} off (official ${pct(w.worst.mape_official, 1)})${weather}.</p></div>`;
  }

  /* Live vs backtest: each live day's error against the range the backtest says is normal */
  function drawExpect(el, days, ex) {
    const css = (v) => getComputedStyle(el).getPropertyValue(v).trim();
    const W = el.clientWidth || 640, H = 190, m = { t: 12, r: 12, b: 26, l: 44 };
    const t = (d) => new Date(d.date + "T00:00:00Z");
    const x0 = d3.utcDay.offset(t(days[0]), -1), x1 = d3.utcDay.offset(t(days[days.length - 1]), 1);
    const x = d3.scaleUtc().domain([x0, x1]).range([m.l, W - m.r]);
    const top = d3.max([ex.ours.p90, ex.official.p90, ...days.map((d) => Math.max(d.mape_ours, d.mape_official))]) * 1.15;
    const y = d3.scaleLinear().domain([0, top]).nice().range([H - m.b, m.t]);
    const inside = days.filter((d) => d.mape_ours >= ex.ours.p10 && d.mape_ours <= ex.ours.p90).length;
    el.innerHTML = `<div class="track-head"><h3>Live vs the backtest</h3>` +
      `<span class="key"><i class="sw band"></i>Backtest: 80% of days</span><span class="key"><i class="sw dash"></i>Typical backtest day (${pct(ex.ours.p50, 1)})</span><span class="key"><i class="sw dot" style="background:var(--ours)"></i>My model, live</span><span class="key"><i class="sw dot" style="background:var(--official)"></i>Official, live</span></div>`;
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", `Daily live error compared with the backtest range: ${inside} of ${days.length} live days inside it`);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("rect").attr("x", m.l).attr("width", W - m.l - m.r).attr("y", y(ex.ours.p90)).attr("height", y(ex.ours.p10) - y(ex.ours.p90)).attr("fill", css("--ours-band"));
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(ex.ours.p50)).attr("y2", y(ex.ours.p50)).attr("stroke", css("--ours")).attr("stroke-width", 1.5).attr("stroke-dasharray", "4 4");
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((v) => (v * 100).toFixed(0) + "%"));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(d3.utcDay.every(Math.max(1, Math.ceil((days.length + 2) / Math.max(2, Math.floor((W - m.l - m.r) / 64)))))).tickFormat(d3.utcFormat("%b %-d")));   // ~64px per label
    const g = svg.selectAll("g.day").data(days).join("g").attr("class", "day").attr("tabindex", 0)
      .attr("aria-label", (d) => `${d.date}: mine ${pct(d.mape_ours, 2)}, official ${pct(d.mape_official, 2)}`);
    g.append("circle").attr("cx", (d) => x(t(d))).attr("cy", (d) => y(d.mape_official)).attr("r", 4.5).attr("fill", css("--official")).attr("stroke", css("--surface")).attr("stroke-width", 2);
    g.append("circle").attr("cx", (d) => x(t(d))).attr("cy", (d) => y(d.mape_ours)).attr("r", 5.5).attr("fill", css("--ours")).attr("stroke", css("--surface")).attr("stroke-width", 2);
    g.append("rect").attr("x", (d) => x(t(d)) - 12).attr("width", 24).attr("y", m.t).attr("height", H - m.t - m.b).attr("fill", "transparent");
    const html = (d) => `<div class="t">${d3.utcFormat("%a, %b %-d")(t(d))}</div>` + row("My error", pct(d.mape_ours, 2), css("--ours")) + row("Official error", pct(d.mape_official, 2), css("--official")) +
      row("Backtest normal", `${pct(ex.ours.p10, 1)}–${pct(ex.ours.p90, 1)}`);
    g.on("mousemove focus", (ev, d) => showTip(html(d), ev)).on("mouseleave blur", hideTip);
    el.insertAdjacentHTML("beforeend", `<p class="cap">${inside} of ${days.length} live day${days.length > 1 ? "s" : ""} fell inside the range where 80% of the ${ex.days} backtest days landed. ` +
      `If the backtest was honest, about 8 in 10 live days should too; a run of days above the band would mean the backtest flattered the model.</p>`);
  }

  /* live track record: one square per scored day, colored by which forecast was closer */
  function calendarHTML(days) {
    if (!days.length) return "";
    const h = S.headline, w = (k) => d3.sum(days, (d) => d[k]) / days.length;
    const mine = w("mape_ours"), off = w("mape_official"), dayWins = days.filter((d) => d.mape_ours < d.mape_official).length;
    const first = new Date(days[0].date + "T12:00:00Z"), last = new Date(days[days.length - 1].date + "T12:00:00Z");
    const start = d3.utcSunday.floor(first), byDate = new Map(days.map((d) => [d.date, d]));
    const weeks = d3.utcWeek.count(start, last) + 1, cs = 16, gap = 3;
    let cells = "";
    for (let t = new Date(start); t <= last; t = d3.utcDay.offset(t, 1)) {
      const key = t.toISOString().slice(0, 10), d = byDate.get(key);
      const col = d3.utcWeek.count(start, t), rowi = t.getUTCDay();
      const fill = !d ? "var(--ring)" : d.mape_ours < d.mape_official ? "var(--ours)" : "var(--official)";
      cells += `<rect x="${col * (cs + gap)}" y="${rowi * (cs + gap) + 16}" width="${cs}" height="${cs}" rx="3" fill="${fill}"${d ? ` data-date="${key}" tabindex="0" role="img" aria-label="${key}: ${d.mape_ours < d.mape_official ? "my model closer" : "official closer"}, mine ${pct(d.mape_ours, 2)}, official ${pct(d.mape_official, 2)}"` : ' aria-hidden="true"'}/>`;
    }
    const months = d3.utcMonths(d3.utcMonth.ceil(start), d3.utcDay.offset(last, 1));
    const mlabels = [start, ...months].filter((m, i, a) => i === 0 || +m !== +a[0]).map((m) =>
      `<text class="lbl" x="${d3.utcWeek.count(start, m) * (cs + gap)}" y="11">${d3.utcFormat("%b")(m)}</text>`).join("");
    const Wd = weeks * (cs + gap);
    return `<div class="track"><div class="track-head"><h3>Track record</h3>` +
      `<span class="key"><i class="sw" style="background:var(--ours)"></i>My model closer</span><span class="key"><i class="sw" style="background:var(--official)"></i>Official closer</span></div>` +
      `<div class="track-cal"><svg width="${Wd}" height="${7 * (cs + gap) + 16}" viewBox="0 0 ${Wd} ${7 * (cs + gap) + 16}">${mlabels}${cells}</svg></div>` +
      `<p class="cap">Live so far: my demand-weighted error <b>${pct(mine, 2)}</b> vs official <b>${pct(off, 2)}</b>, closer on <b>${dayWins} of ${days.length}</b> days. ` +
      `In the backtest it was ${pct(h.load_weighted_mape_ours, 2)} vs ${pct(h.load_weighted_mape_official, 2)}; if the live numbers stay close to that, the backtest held up.</p></div>`;
  }
  function bindCalendar(el, days) {
    const byDate = new Map(days.map((d) => [d.date, d]));
    el.querySelectorAll(".track rect[data-date]").forEach((r) => {
      const d = byDate.get(r.dataset.date);
      const html = () => `<div class="t">${d3.utcFormat("%a, %b %-d %Y")(new Date(d.date + "T12:00:00Z"))}</div>` + row("My error", pct(d.mape_ours, 2), css("--ours")) +
        row("Official error", pct(d.mape_official, 2), css("--official")) + row("Regions I won", `${d.regions_won} of ${d.regions}`);
      r.addEventListener("mousemove", (ev) => showTip(html(), ev)); r.addEventListener("mouseleave", hideTip);
      r.addEventListener("focus", (ev) => showTip(html(), ev)); r.addEventListener("blur", hideTip);
    });
  }

  /* ---------- page behaviour: side menu, reveal ---------- */
  function scrollSpy() {
    const links = $$(".toc a"), ids = links.map((a) => a.getAttribute("href").slice(1));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id)); });
    }, { rootMargin: "-40% 0px -55% 0px" });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
  }
  let revealIO = null;
  function observeReveal() {
    if (reduceMotion || !("IntersectionObserver" in window)) { $$(".reveal").forEach((el) => el.classList.add("in")); return; }
    revealIO = revealIO || new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealIO.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    $$(".reveal:not(.in)").forEach((el) => revealIO.observe(el));
  }

  /* ---------- boot ---------- */
  // Above-the-fold content renders immediately; every other section is drawn just before it
  // scrolls into view, so the first screen never waits on charts the visitor hasn't reached yet.
  const LAZY = {
    results: () => { renderMap(); renderTable(); },
    explore: () => renderExplorer(),
    game: () => { if (!game.init) { game.init = true; renderGame(); } else if (game.s) drawGame(); },
    when: () => renderWhen(),
    peaks: () => renderPeaks(),
    together: () => renderBlend(),
    misses: () => renderMisses(),
    live: () => renderLive(),
  };
  const drawn = new Set();
  function renderSection(id) { drawn.add(id); LAZY[id](); glossify(document.getElementById(id)); }
  function lazyRender() {
    if (!("IntersectionObserver" in window)) { Object.keys(LAZY).forEach(renderSection); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !drawn.has(e.target.id)) { io.unobserve(e.target); renderSection(e.target.id); }
    }), { rootMargin: "600px 0px" });
    Object.keys(LAZY).forEach((id) => io.observe(document.getElementById(id)));
  }
  // Jumping to a section (menu, buttons, a shared #link) must first draw every lazy section above it;
  // otherwise those charts appear mid-jump, push the page down, and the jump lands short.
  const isBefore = (el, target) => el === target || el.contains(target) || Boolean(el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
  function drawUpTo(target) {
    Object.keys(LAZY).forEach((id) => { if (isBefore(document.getElementById(id), target) && !drawn.has(id)) renderSection(id); });
  }
  function jumpTo(hash, smooth) {
    const target = hash && hash.length > 1 && document.getElementById(decodeURIComponent(hash.slice(1).split("?")[0]));
    if (!target) return false;
    drawUpTo(target);
    $$(".reveal:not(.in)").forEach((el) => { if (isBefore(el, target) || target.contains(el)) el.classList.add("in"); });
    target.scrollIntoView({ behavior: smooth && !reduceMotion ? "smooth" : "auto" });
    holdPosition(target, smooth && !reduceMotion ? 900 : 0);
    return true;
  }
  // Content above the target can still be filling in (the map, async text). For a moment after a jump, keep the
  // target where it landed, unless the visitor starts scrolling themselves.
  function holdPosition(target, delay) {
    const want = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 72, t0 = performance.now();
    let stop = false;
    const quit = () => { stop = true; };
    ["wheel", "touchstart", "keydown", "mousedown"].forEach((ev) => addEventListener(ev, quit, { once: true, passive: true }));
    const tick = () => {
      if (stop || performance.now() - t0 > delay + 1500) return;
      if (performance.now() - t0 > delay && Math.abs(target.getBoundingClientRect().top - want) > 4) target.scrollIntoView({ behavior: "auto" });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function bindAnchors() {
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (jumpTo(a.getAttribute("href"), true)) { e.preventDefault(); history.pushState(null, "", a.getAttribute("href")); }
    });
    addEventListener("popstate", () => jumpTo(location.hash, false));
    if (location.hash) requestAnimationFrame(() => jumpTo(location.hash, false));
  }
  function renderAll() {
    renderStatus(); renderVersion(); renderFindings(); renderScoreboard(); renderHeroChart();
    drawn.forEach((id) => LAZY[id]());
  }
  // Selecting a region from the map/table must work even if the explorer hasn't been drawn yet
  const _select = select;
  select = (ba) => { drawn.add("explore"); _select(ba); };
  async function boot() {
    $$("main section .card, main section .tiles, main section .grid2, main .accordion").forEach((el) => el.classList.add("reveal"));
    const get = (f) => fetch("data/" + f, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    [S, LB, BR, LIVE, window.REGION_TZ, window.BLEND, window.VALUE, window.WHY, window.MISSES, window.PEAKS] = await Promise.all(
      ["summary.json", "leaderboard.json", "breakdowns.json", "live.json", "regions_tz.json", "blend.json", "value.json", "why.json", "misses.json", "peaks.json"].map(get));
    if (!S || !LB) throw new Error("results data missing");
    BR = BR || {}; LIVE = LIVE || {};
    const opts = LB.slice().sort((a, b) => a.name.localeCompare(b.name)).map((d) => `<option value="${d.ba}">${d.name} (${d.area})</option>`).join("");
    $("#regionSel").innerHTML = opts;
    $("#compareSel").innerHTML = `<option value="">None</option>` + opts;
    $("#regionSel").addEventListener("change", (e) => { select(e.target.value); syncView(); });
    $("#compareSel").addEventListener("change", (e) => { compare = e.target.value; renderCompare(); syncView(); });
    $("#linkBtn").addEventListener("click", (e) => copyText(viewLink(), e.currentTarget, "Link copied"));
    $$("#rangeSeg button").forEach((b) => b.addEventListener("click", () => {
      rangeDays = +b.dataset.d; $$("#rangeSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderExplorer(); syncView();
    }));
    $("#csvBtn").addEventListener("click", downloadCSV);
    $$("#filters .chip").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.f)));
    $("#showSuspect").addEventListener("change", renderTable);
    $("#peakMore").addEventListener("click", () => { peakAll = !peakAll; renderPeaks(); });
    $("#lbMore").addEventListener("click", () => { tableAll = !tableAll; renderTable(); if (!tableAll) $("#lb").scrollIntoView({ block: "nearest" }); });
    selected = savedBA() || (LB.find((d) => d.ba === "ERCO") || LB[0]).ba;
    renderFindGrid();
    viewFromHash();
    $("#regionSel").value = selected;
    renderAll();
    renderTicker();
    lazyRender();
    scrollSpy(); observeReveal(); bindAnchors(); bindGlossary();
    ["top", "scoreboard", "method", "why", "live"].forEach((id) => glossify(document.getElementById(id)));
    $("#findLink").addEventListener("click", () => setTimeout(() => $("#stateSel").focus({ preventScroll: true }), reduceMotion ? 50 : 700));
    document.addEventListener("themechange", renderAll);
    let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => {
      renderHeroChart(); if (drawn.has("explore")) renderExplorer(); if (drawn.has("when")) renderWhen(); if (drawn.has("peaks")) renderPeaks(); if (game.s) drawGame(); }, 200); });
  }
  boot().catch((e) => {
    console.error(e);
    $("#vSub").textContent = "Couldn't load the results. Please refresh the page.";
    ["#heroChart", "#map", "#seriesChart"].forEach((s) => fail($(s), "the data"));
  });
})();
