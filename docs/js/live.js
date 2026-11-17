/* The live record: track-record calendar, live versus backtest, weekly summary, region table and voided forecasts. */
import { st } from "./state.js?v=45fc8122f9";
import { $, css, fd, hideTip, pct, row, showTip } from "./util.js?v=45fc8122f9";
import { goExplore } from "./regions.js?v=45fc8122f9";

/* ---------- live ---------- */
export function voidNote(L) {
  const v = (L && L.voided) || [];
  return v.length ? `<details class="more"><summary>${v.length} voided forecast${v.length > 1 ? "s" : ""}</summary>` +
    v.map((d) => `<p><b>${fd(d.date)}</b>, voided ${fd(d.voided_at_utc, false)} at ${d.voided_at_utc.slice(11, 16)} UTC, before the day began: ${d.reason}</p>`).join("") + `</details>` : "";
}
export function renderLive() {
  const el = $("#liveCard"), L = st.LIVE;
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
    rows.map((r, i) => { const meta = st.LB.find((x) => x.ba === r.ba) || {}; return `<tr data-ba="${r.ba}" tabindex="0"${i >= 10 ? ' class="extra"' : ""}><td class="reg"><b>${meta.name || r.ba}</b><span>${r.ba}</span></td><td class="num" data-label="Days">${r.days}</td><td class="num" data-label="My error">${pct(r.mape_ours, 2)}</td><td class="num" data-label="Official">${pct(r.mape_official, 2)}</td><td class="num" data-label="Days closer">${r.days_won} of ${r.days}</td></tr>`; }).join("") +
    `</tbody></table></div>` +
    (rows.length > 12 ? `<button type="button" class="ghost" id="liveMore" aria-expanded="false" aria-controls="liveTable">Show all ${rows.length} regions</button>` : "") + voidNote(L);
  bindCalendar(el, L.by_day || []);
  const lm = $("#liveMore");
  if (lm) lm.addEventListener("click", () => { const all = $("#liveTable").classList.toggle("all"); lm.textContent = all ? "Show the first 10 only" : `Show all ${rows.length} regions`; lm.setAttribute("aria-expanded", String(all)); });
  if ($("#expectChart")) drawExpect($("#expectChart"), L.by_day, L.expect);
  el.querySelectorAll("tr[data-ba]").forEach((tr) => { tr.addEventListener("click", () => goExplore(tr.dataset.ba)); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") goExplore(tr.dataset.ba); }); });
}

/* "This week": the last seven scored days in a few plain sentences (built by site_data.weekly_summary) */
export function weekHTML(w) {
  if (!w) return "";
  const nm = (ba) => (st.LB.find((x) => x.ba === ba) || {}).name || ba;
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
export function drawExpect(el, days, ex) {
  const bandCss = (v) => getComputedStyle(el).getPropertyValue(v).trim();   // this chart sits in the dark band: read its own palette
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
  svg.append("rect").attr("x", m.l).attr("width", W - m.l - m.r).attr("y", y(ex.ours.p90)).attr("height", y(ex.ours.p10) - y(ex.ours.p90)).attr("fill", bandCss("--ours-band"));
  svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(ex.ours.p50)).attr("y2", y(ex.ours.p50)).attr("stroke", bandCss("--ours")).attr("stroke-width", 1.5).attr("stroke-dasharray", "4 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((v) => (v * 100).toFixed(0) + "%"));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(d3.utcDay.every(Math.max(1, Math.ceil((days.length + 2) / Math.max(2, Math.floor((W - m.l - m.r) / 64)))))).tickFormat(d3.utcFormat("%b %-d")));   // ~64px per label
  const g = svg.selectAll("g.day").data(days).join("g").attr("class", "day").attr("tabindex", 0)
    .attr("aria-label", (d) => `${d.date}: mine ${pct(d.mape_ours, 2)}, official ${pct(d.mape_official, 2)}`);
  g.append("circle").attr("cx", (d) => x(t(d))).attr("cy", (d) => y(d.mape_official)).attr("r", 4.5).attr("fill", bandCss("--official")).attr("stroke", bandCss("--surface")).attr("stroke-width", 2);
  g.append("circle").attr("cx", (d) => x(t(d))).attr("cy", (d) => y(d.mape_ours)).attr("r", 5.5).attr("fill", bandCss("--ours")).attr("stroke", bandCss("--surface")).attr("stroke-width", 2);
  g.append("rect").attr("x", (d) => x(t(d)) - 12).attr("width", 24).attr("y", m.t).attr("height", H - m.t - m.b).attr("fill", "transparent");
  const html = (d) => `<div class="t">${d3.utcFormat("%a, %b %-d")(t(d))}</div>` + row("My error", pct(d.mape_ours, 2), bandCss("--ours")) + row("Official error", pct(d.mape_official, 2), bandCss("--official")) +
    row("Backtest normal", `${pct(ex.ours.p10, 1)}–${pct(ex.ours.p90, 1)}`);
  g.on("mousemove focus", (ev, d) => showTip(html(d), ev)).on("mouseleave blur", hideTip);
  el.insertAdjacentHTML("beforeend", `<p class="cap">${inside} of ${days.length} live day${days.length > 1 ? "s" : ""} fell inside the range where 80% of the ${ex.days} backtest days landed. ` +
    `If the backtest was honest, about 8 in 10 live days should too; a run of days above the band would mean the backtest flattered the model.</p>`);
}

/* live track record: one square per scored day, colored by which forecast was closer */
export function calendarHTML(days) {
  if (!days.length) return "";
  const h = st.S.headline, w = (k) => d3.sum(days, (d) => d[k]) / days.length;
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
export function bindCalendar(el, days) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  el.querySelectorAll(".track rect[data-date]").forEach((r) => {
    const d = byDate.get(r.dataset.date);
    const html = () => `<div class="t">${d3.utcFormat("%a, %b %-d %Y")(new Date(d.date + "T12:00:00Z"))}</div>` + row("My error", pct(d.mape_ours, 2), css("--ours")) +
      row("Official error", pct(d.mape_official, 2), css("--official")) + row("Regions I won", `${d.regions_won} of ${d.regions}`);
    r.addEventListener("mousemove", (ev) => showTip(html(), ev)); r.addEventListener("mouseleave", hideTip);
    r.addEventListener("focus", (ev) => showTip(html(), ev)); r.addEventListener("blur", hideTip);
  });
}
