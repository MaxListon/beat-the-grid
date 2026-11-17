/* The explorer: one region hour by hour, comparisons, shareable views, 'Find your grid' and the live forecast card. */
import { st } from "./state.js?v=f618dea0d4";
import { $, $$, MINUS, css, fail, gw, pct, reduceMotion, relDay, storeGet, storeSet } from "./util.js?v=f618dea0d4";
import { drawSeries, expand, lastDays, legendHTML, loadSeries, statsHTML } from "./charts.js?v=f618dea0d4";
import { GAME_LIST, game, newGame } from "./game.js?v=f618dea0d4";

/* ---------- explorer ---------- */
export function select(ba) {
  st.drawn.add("explore");
  st.selected = ba; $("#regionSel").value = ba;
  d3.selectAll(".dot").classed("sel", (d) => d.ba === ba);
  renderExplorer();
}
export async function renderExplorer() {
  const want = st.selected, el = $("#seriesChart");
  const d = await loadSeries(want);
  if (want !== st.selected) return;
  if (!d) { fail(el, "this region's data"); return; }
  const s = lastDays(expand(d), st.rangeDays), meta = st.LB.find((r) => r.ba === want) || {};
  $("#seriesLegend").innerHTML = legendHTML(false);
  $("#regionStats").innerHTML = statsHTML(s, want);
  drawSeries(el, s, want, { label: `Hourly electricity demand in ${meta.name || want} over the last ${st.rangeDays} days: actual demand, my forecast with its 80% range, and the official day-ahead forecast.` });
  renderWhy();
  renderCompare();
}
export async function renderCompare() {
  const wrap = $("#compareWrap");
  if (!st.compare || st.compare === st.selected) { wrap.hidden = true; return; }
  const want = st.compare, d = await loadSeries(want);
  if (want !== st.compare) return;
  wrap.hidden = false;
  const meta = st.LB.find((r) => r.ba === want) || {};
  $("#compareTitle").textContent = `${meta.name || want} (${meta.area || ""})`;
  if (!d) { fail($("#compareChart"), "this region's data"); return; }
  const s = lastDays(expand(d), st.rangeDays);
  $("#compareStats").innerHTML = statsHTML(s, want);
  drawSeries($("#compareChart"), s, want, { label: `Comparison: hourly demand in ${meta.name || want} over the last ${st.rangeDays} days.` });
}
export async function downloadCSV() {
  const d = await loadSeries(st.selected); if (!d) return;   // cached after the first load
  const s = lastDays(expand(d), st.rangeDays), tz = (window.REGION_TZ || {})[st.selected];
  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const lines = ["hour_ending_utc,hour_ending_local,actual_mw,official_forecast_mw,my_forecast_mw,my_p10_mw,my_p90_mw,is_live_forecast"];
  s.t.forEach((t, i) => lines.push([t.toISOString(), fmt.format(t), s.actual[i] ?? "", s.official[i] ?? "", s.p50[i] ?? "", s.p10[i] ?? "", s.p90[i] ?? "", s.live[i]].join(",")));
  const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `beat-the-grid_${st.selected}_last${st.rangeDays}days.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- shareable explorer views: #explore?region=ERCO&days=30&compare=PJM ---------- */
export function viewFromHash() {
  const q = location.hash.split("?")[1];
  if (!q || !location.hash.startsWith("#explore")) return;
  const sp = new URLSearchParams(q), ba = sp.get("region"), cmp = sp.get("compare"), d = +sp.get("days");
  if (ba && st.LB.some((r) => r.ba === ba)) st.selected = ba;
  if ([7, 14, 30].includes(d)) { st.rangeDays = d; $$("#rangeSeg button").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.d === d))); }
  if (cmp && st.LB.some((r) => r.ba === cmp)) { st.compare = cmp; $("#compareSel").value = cmp; }
}
export function viewLink() {
  const sp = new URLSearchParams({ region: st.selected, days: st.rangeDays });
  if (st.compare) sp.set("compare", st.compare);
  return `${location.origin}${location.pathname}#explore?${sp}`;
}
export const syncView = () => { try { history.replaceState(null, "", "#explore?" + viewLink().split("#explore?")[1]); } catch (e) { /* file:// */ } };
/* ---------- "Find your grid": a state picker that jumps to the region serving most of that state ---------- */
export const STATE_BA = {
  Alabama: "SOCO", Arizona: "AZPS", Arkansas: "MISO", California: "CISO", Colorado: "PSCO", Connecticut: "ISNE", Delaware: "PJM",
  "District of Columbia": "PJM", Florida: "FPL", Georgia: "SOCO", Idaho: "IPCO", Illinois: "PJM", Indiana: "MISO", Iowa: "MISO",
  Kansas: "SWPP", Kentucky: "LGEE", Louisiana: "MISO", Maine: "ISNE", Maryland: "PJM", Massachusetts: "ISNE", Michigan: "MISO",
  Minnesota: "MISO", Mississippi: "MISO", Missouri: "MISO", Nebraska: "SWPP", Nevada: "NEVP", "New Hampshire": "ISNE",
  "New Jersey": "PJM", "New Mexico": "PNM", "New York": "NYIS", "North Carolina": "DUK", "North Dakota": "MISO", Ohio: "PJM",
  Oklahoma: "SWPP", Oregon: "PGE", Pennsylvania: "PJM", "Rhode Island": "ISNE", "South Carolina": "SCEG", "South Dakota": "SWPP",
  Tennessee: "TVA", Texas: "ERCO", Utah: "PACE", Vermont: "ISNE", Virginia: "PJM", Washington: "PSEI", "West Virginia": "PJM",
  Wisconsin: "MISO", Wyoming: "PACE", Montana: null, Alaska: null, Hawaii: null,
};
export function findGridText(state, ba) {
  if (!ba) return state === "Montana"
    ? "Montana's main grid operator, NorthWestern Energy, isn't one of the 34 regions in the contest."
    : `${state} runs its own electric grid, separate from the mainland regions in this contest.`;
  const d = st.LB.find((r) => r.ba === ba) || {};
  const how = d.suspect_official ? "its official forecast data looked unreliable, so it isn't scored in the contest"
    : d.verdict === "win" ? `my model beat the operator's own forecast there in the backtest (${pct(d.mape_ours, 2)} vs ${pct(d.mape_official, 2)} average error)`
    : d.verdict === "loss" ? `the operator's own forecast beat my model there (${pct(d.mape_official, 2)} vs my ${pct(d.mape_ours, 2)})`
    : `my model and the operator were statistically tied there (${pct(d.mape_ours, 2)} vs ${pct(d.mape_official, 2)})`;
  return `Most of ${state} is served by <b>${d.name || ba}</b>, and ${how}. The charts below now show your grid.`;
}
export function chooseState(state, quiet) {
  const ba = STATE_BA[state];
  $("#findOut").innerHTML = state ? findGridText(state, ba) : "";
  storeSet("btg-state", state || "");
  if (!ba) return;
  select(ba);
  if (game.init && !game.revealed && game.ba !== ba && GAME_LIST().includes(ba)) { $("#gameRegion").value = ba; newGame(ba); }
  if (!quiet) document.getElementById("explore").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
export function renderFindGrid() {
  const sel = $("#stateSel");
  sel.innerHTML = `<option value="">Pick your state</option>` + Object.keys(STATE_BA).sort().map((name) => `<option>${name}</option>`).join("");
  sel.addEventListener("change", () => chooseState(sel.value, true));
  const saved = storeGet("btg-state");
  if (saved && saved in STATE_BA) { sel.value = saved; $("#findOut").innerHTML = findGridText(saved, STATE_BA[saved]); }
}
export const savedBA = () => { const state = storeGet("btg-state"); return state && STATE_BA[state] ? STATE_BA[state] : null; };

/* ---------- tomorrow: why ---------- */
export function renderWhy() {
  const el = $("#whyCard"), W = window.WHY, r = W && W.regions && W.regions[st.selected];
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
