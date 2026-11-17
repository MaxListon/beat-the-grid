/* 'Can you beat the model?': draw the next 24 hours of a real past day, then compare with my model and the operator. */
import { st } from "./state.js?v=b26b5e6139";
import { $, copyText, css, fail, gw, pct, reduceMotion } from "./util.js?v=b26b5e6139";
import { expand, loadSeries } from "./charts.js?v=b26b5e6139";
import { savedBA } from "./explorer.js?v=b26b5e6139";

/* ---------- "Can you beat the model?": draw the next 24 hours, then compare with my model and the operator ---------- */
export const GAME_LIST = () => st.LB.filter((d) => !d.suspect_official).sort((a, b) => b.mean_mw - a.mean_mw).map((d) => d.ba);
export const game = { ba: "PJM", s: null, day: null, guess: null, revealed: false, used: new Set(), cur: 0, kb: false };
export const gameRecord = () => { try { return JSON.parse(localStorage.getItem("btg-game") || "{}"); } catch (e) { return {}; } };
export function saveRecord(r) { try { localStorage.setItem("btg-game", JSON.stringify(r)); } catch (e) { /* private mode: no record */ } }
export function showRecord() {
  const r = gameRecord();
  $("#gameRecord").textContent = r.played ? `Your record: ${r.played} day${r.played > 1 ? "s" : ""} played, beat my model ${r.beatMine || 0}, beat the operator ${r.beatOfficial || 0}` : "";
}
// Complete local days (midnight to midnight in the region's time zone) with actual, official and my forecast for all
// 24 hours, three full days of history before them, and nothing from the live forecast.
export function gameDays(s, tz) {
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
export async function newGame(ba) {
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
export function drawGame() {
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
export function fillGaps(g) {
  const known = g.map((v, k) => [k, v]).filter((p) => p[1] != null);
  return g.map((v, k) => {
    if (v != null) return v;
    const a = known.filter((p) => p[0] < k).pop(), b = known.find((p) => p[0] > k);
    return a && b ? a[1] + (b[1] - a[1]) * (k - a[0]) / (b[0] - a[0]) : (a || b)[1];
  });
}
export function reveal() {
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
  const region = (st.LB.find((d) => d.ba === game.ba) || {}).name || game.ba, dayName = $("#gameDay").textContent;
  const brag = beatMine && beatOff ? `I beat both a machine-learning model and the grid operator` : beatOff ? `I beat the grid operator` : beatMine ? `I beat the machine-learning model` : `I tried to out-forecast the grid`;
  const share = `${brag} forecasting electricity demand for ${region} on ${dayName}: my error ${pct(you, 1)}, the model ${pct(mine, 1)}, the operator ${pct(off, 1)}. Can you do better?`;
  $("#gameShare").addEventListener("click", async (e) => {
    const url = `${location.origin}${location.pathname}#game`;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { try { await navigator.share({ title: "Beat the Grid", text: share, url }); return; } catch (cancelled) { /* the visitor closed the share sheet */ } }
    copyText(`${share} ${url}`, e.currentTarget, "Copied, paste it anywhere");
  });
  $("#gameReveal").hidden = true;
  $("#gameHint").textContent = "The line that continues the history is what actually happened. Try another day or another region.";
  drawGame();
}
export function renderGame() {
  const sel = $("#gameRegion");
  sel.innerHTML = GAME_LIST().map((ba) => { const m = st.LB.find((d) => d.ba === ba) || {}; return `<option value="${ba}">${m.name || ba}</option>`; }).join("");
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
