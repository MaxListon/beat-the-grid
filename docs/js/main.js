/* Start-up and navigation: loads the data, draws sections lazily as they approach, and makes in-page jumps land exactly. */
import { st } from "./state.js?v=45fc8122f9";
import { $, $$, copyText, fail, reduceMotion } from "./util.js?v=45fc8122f9";
import { renderFindings, renderHeroChart, renderScoreboard, renderStatus, renderTicker, renderVersion } from "./overview.js?v=45fc8122f9";
import { renderMap, renderTable, setFilter, toggleTable } from "./regions.js?v=45fc8122f9";
import { downloadCSV, renderCompare, renderExplorer, renderFindGrid, savedBA, select, syncView, viewFromHash, viewLink } from "./explorer.js?v=45fc8122f9";
import { bindGlossary, glossify } from "./glossary.js?v=45fc8122f9";
import { drawGame, game, renderGame } from "./game.js?v=45fc8122f9";
import { renderBlend, renderMisses, renderPeaks, renderWhen, togglePeaks } from "./analysis.js?v=45fc8122f9";
import { renderLive } from "./live.js?v=45fc8122f9";

/* ---------- page behaviour: side menu, reveal ---------- */
export function scrollSpy() {
  const links = $$(".toc a"), ids = links.map((a) => a.getAttribute("href").slice(1));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id)); });
  }, { rootMargin: "-40% 0px -55% 0px" });
  ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
}
let revealIO = null;
export function observeReveal() {
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
export function renderSection(id) { st.drawn.add(id); LAZY[id](); glossify(document.getElementById(id)); }
export function lazyRender() {
  if (!("IntersectionObserver" in window)) { Object.keys(LAZY).forEach(renderSection); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting && !st.drawn.has(e.target.id)) { io.unobserve(e.target); renderSection(e.target.id); }
  }), { rootMargin: "600px 0px" });
  Object.keys(LAZY).forEach((id) => io.observe(document.getElementById(id)));
}
// Jumping to a section (menu, buttons, a shared #link) must first draw every lazy section above it;
// otherwise those charts appear mid-jump, push the page down, and the jump lands short.
export const isBefore = (el, target) => el === target || el.contains(target) || Boolean(el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
export function drawUpTo(target) {
  Object.keys(LAZY).forEach((id) => { if (isBefore(document.getElementById(id), target) && !st.drawn.has(id)) renderSection(id); });
}
export function jumpTo(hash, smooth) {
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
export function holdPosition(target, delay) {
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
export function bindAnchors() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (jumpTo(a.getAttribute("href"), true)) { e.preventDefault(); history.pushState(null, "", a.getAttribute("href")); }
  });
  addEventListener("popstate", () => jumpTo(location.hash, false));
  if (location.hash) requestAnimationFrame(() => jumpTo(location.hash, false));
}
export function renderAll() {
  renderStatus(); renderVersion(); renderFindings(); renderScoreboard(); renderHeroChart();
  st.drawn.forEach((id) => LAZY[id]());
}
export async function boot() {
  $$("main section .card, main section .tiles, main section .grid2, main .accordion").forEach((el) => el.classList.add("reveal"));
  const get = (f) => fetch("data/" + f, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  [st.S, st.LB, st.BR, st.LIVE, window.REGION_TZ, window.BLEND, window.VALUE, window.WHY, window.MISSES, window.PEAKS] = await Promise.all(
    ["summary.json", "leaderboard.json", "breakdowns.json", "live.json", "regions_tz.json", "blend.json", "value.json", "why.json", "misses.json", "peaks.json"].map(get));
  if (!st.S || !st.LB) throw new Error("results data missing");
  st.BR = st.BR || {}; st.LIVE = st.LIVE || {};
  const opts = st.LB.slice().sort((a, b) => a.name.localeCompare(b.name)).map((d) => `<option value="${d.ba}">${d.name} (${d.area})</option>`).join("");
  $("#regionSel").innerHTML = opts;
  $("#compareSel").innerHTML = `<option value="">None</option>` + opts;
  $("#regionSel").addEventListener("change", (e) => { select(e.target.value); syncView(); });
  $("#compareSel").addEventListener("change", (e) => { st.compare = e.target.value; renderCompare(); syncView(); });
  $("#linkBtn").addEventListener("click", (e) => copyText(viewLink(), e.currentTarget, "Link copied"));
  $$("#rangeSeg button").forEach((b) => b.addEventListener("click", () => {
    st.rangeDays = +b.dataset.d; $$("#rangeSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderExplorer(); syncView();
  }));
  $("#csvBtn").addEventListener("click", downloadCSV);
  $$("#filters .chip").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.f)));
  $("#showSuspect").addEventListener("change", renderTable);
  $("#peakMore").addEventListener("click", togglePeaks);
  $("#lbMore").addEventListener("click", toggleTable);
  st.selected = savedBA() || (st.LB.find((d) => d.ba === "ERCO") || st.LB[0]).ba;
  renderFindGrid();
  viewFromHash();
  $("#regionSel").value = st.selected;
  renderAll();
  renderTicker();
  lazyRender();
  scrollSpy(); observeReveal(); bindAnchors(); bindGlossary();
  ["top", "scoreboard", "method", "why", "live"].forEach((id) => glossify(document.getElementById(id)));
  $("#findLink").addEventListener("click", () => setTimeout(() => $("#stateSel").focus({ preventScroll: true }), reduceMotion ? 50 : 700));
  document.addEventListener("themechange", renderAll);
  let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => {
    renderHeroChart(); if (st.drawn.has("explore")) renderExplorer(); if (st.drawn.has("when")) renderWhen(); if (st.drawn.has("peaks")) renderPeaks(); if (game.s) drawGame(); }, 200); });
}
boot().catch((e) => {
  console.error(e);
  $("#vSub").textContent = "Couldn't load the results. Please refresh the page.";
  ["#heroChart", "#map", "#seriesChart"].forEach((s) => fail($(s), "the data"));
});
