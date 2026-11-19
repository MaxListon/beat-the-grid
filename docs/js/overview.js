/* The top of the page: status pill, version badges, hero findings and chart, scoreboard and the live ticker. */
import { st } from "./state.js?v=3f8233ccc6";
import { $, MINUS, fail, fd, gw, pct, reduceMotion, relDay } from "./util.js?v=3f8233ccc6";
import { drawSeries, expand, legendHTML, loadSeries, slice } from "./charts.js?v=3f8233ccc6";
import { select } from "./explorer.js?v=3f8233ccc6";

/* ---------- status pill + version ---------- */
export function renderStatus() {
  const pill = $("#statusPill"), txt = pill.querySelector("span");
  pill.classList.remove("ok", "stale");
  if (!st.LIVE || !st.LIVE.forecasts_issued) { txt.textContent = "Backtest results · live forecasts start at launch"; return; }
  const hours = (Date.now() - Date.parse(st.LIVE.updated_at.replace(" UTC", "Z").replace(" ", "T"))) / 36e5;
  const ago = hours < 1 ? "under an hour ago" : hours < 48 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} days ago`;
  if (hours <= 30) { pill.classList.add("ok"); txt.textContent = `Live · updated ${ago}`; }
  else { pill.classList.add("stale"); txt.textContent = `Last update ${ago}`; }
  pill.title = `Latest forecast published for ${fd(st.LIVE.latest_issued)}`;
}
export function renderVersion() {
  const m = st.S.model || {}, b = st.S.backtest || {};
  const frozen = m.frozen_at_utc ? new Date(m.frozen_at_utc.replace("Z", ":00Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  $("#versionBadge").innerHTML =
    `<span class="badge">Model ${m.version || "v1"}${frozen ? ` · frozen ${frozen}` : ""}</span>` +
    `<span class="badge">${d3.format(",")(b.hours_scored || 0)} hours tested</span>` +
    `<a class="badge" href="changelog.html">Changelog</a>`;
}

/* ---------- hero ---------- */
export function renderFindings() {
  const h = st.S.headline, pjm = st.LB.find((d) => d.ba === "PJM");
  const cut = 1 - h.load_weighted_mape_blend / h.load_weighted_mape_official;
  const items = [
    pjm && pjm.verdict === "win" ? [pct(1 - pjm.mape_ours / pjm.mape_official, 0), `lower error than the operator in PJM, the largest US grid (${pct(pjm.mape_ours, 2)} vs ${pct(pjm.mape_official, 2)})`]
      : [`${h.wins}/${h.regions_fair}`, "regions where my model beats the official forecast"],
    [MINUS + pct(cut, 0), `error when operators blend my model with their own forecast (better in ${h.blend_beats_official} of ${h.regions_fair} regions)`],
    [`${h.wins}–${h.losses}`, `wins and losses across ${h.regions_fair} regions, ${h.ties} ties. The operators win more regions, and the site shows where.`],
  ];
  $("#findings").innerHTML = items.map(([b, t]) => `<li><b>${b}</b><span>${t}</span></li>`).join("");
}
/* Live record strip: the out-of-sample score, above the fold. Days are scored about two days after they end. */
export function renderLiveStrip() {
  const el = $("#liveStrip"), L = st.LIVE || {};
  if (!el || !L.forecasts_issued) return;
  const days = L.by_day || [];
  const day = (d) => d3.utcFormat("%b %-d")(new Date(d + "T12:00:00Z"));
  let text;
  if (days.length) {
    const avg = (k) => d3.mean(days, (d) => d[k]), won = days.filter((d) => d.mape_ours < d.mape_official).length;
    text = `<b>Live record:</b> closer on ${won} of ${days.length} day${days.length > 1 ? "s" : ""}, ${pct(avg("mape_ours"), 2)} vs ${pct(avg("mape_official"), 2)} official error`;
  } else {
    const due = L.first_issued ? d3.utcDay.offset(new Date(L.first_issued + "T12:00:00Z"), 2) : null;
    const when = due && due > new Date() ? `first scores due ${day(due.toISOString().slice(0, 10))}` : "first scores coming soon";
    text = `<b>Live now:</b> ${L.forecasts_issued} forecast${L.forecasts_issued > 1 ? "s" : ""} published, ${when}`;
  }
  el.innerHTML = `<i class="sdot" aria-hidden="true"></i><span class="txt">${text}</span><span class="arr" aria-hidden="true">→</span>`;
  el.hidden = false;
}
export async function renderHeroChart() {
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
export function renderScoreboard() {
  const h = st.S.headline, b = st.S.backtest, strict = h.strict || {};
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
    (strict.regions ? `<p><b>Strict check:</b> limited to the ${strict.regions} regions whose official forecast is clearly genuine (median error under ${Math.round(strict.threshold * 100)}%), the score is ${strict.wins} wins, ${strict.losses} losses and ${strict.ties} ties, with a demand-weighted error of ${pct(strict.load_weighted_mape_ours, 2)} for mine vs ${pct(strict.load_weighted_mape_official, 2)} official.</p>` : "");
  $("#updated").textContent = `Backtest built ${st.S.generated_at}` + (st.LIVE.updated_at ? ` · live data updated ${st.LIVE.updated_at}` : "");
}

/* ---------- live ticker: tomorrow's forecast for every region, scrolling under a pause button ---------- */
export function renderTicker() {
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
