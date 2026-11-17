/* Small helpers shared by every module: formatting, the tooltip, browser storage, copying text. */

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));
export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const pct = (x, d = 1) => (x == null || isNaN(x) ? "–" : (x * 100).toFixed(d) + "%");
export const gw = (mw) => (mw == null ? "–" : (mw >= 10000 ? (mw / 1000).toFixed(0) : (mw / 1000).toFixed(1)) + " GW");
export const MINUS = "−";
export const isoLocal = (d) => d.toLocaleDateString("en-CA");          // YYYY-MM-DD in the visitor's time zone
export const relDay = (iso) => { const t = new Date(); if (iso === isoLocal(t)) return "Today"; t.setDate(t.getDate() + 1); return iso === isoLocal(t) ? "Tomorrow" : ""; };
// "2026-11-17" -> "Nov 17, 2026" (or "Nov 17"); dates are calendar days, so format in UTC at noon
export const fd = (iso, year = true) => (iso ? d3.utcFormat(year ? "%b %-d, %Y" : "%b %-d")(new Date(String(iso).slice(0, 10) + "T12:00:00Z")) : "–");
export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const VERDICT = {
  win: { icon: "✓", label: "Model wins", short: "Win", cls: "win", color: () => css("--ours") },
  loss: { icon: "✕", label: "Official wins", short: "Loss", cls: "loss", color: () => css("--official") },
  tie: { icon: "–", label: "No significant difference", short: "Tie", cls: "tie", color: () => css("--tie") },
};

/* ---------- tooltip ---------- */
export const tip = $("#tip");
export function showTip(html, ev) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect(), pad = 14;
  let x = (ev.clientX ?? 0) + pad, y = (ev.clientY ?? 0) + pad;
  if (ev.type === "focus" && ev.target) { const b = ev.target.getBoundingClientRect(); x = b.right + pad; y = b.top; }
  if (x + r.width > innerWidth - 8) x = Math.max(8, x - r.width - 2 * pad);
  if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
  tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
}
export const hideTip = () => { tip.hidden = true; };
export const row = (label, val, color) =>
  `<div class="row"><span>${color ? `<i class="sw" style="background:${color}"></i>` : ""}${label}</span><span>${val}</span></div>`;
export const fail = (el, what) => { if (el) el.innerHTML = `<p class="load-error">Couldn't load ${what}. Please refresh the page.</p>`; };

export async function copyText(text, btn, done) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    const ta = Object.assign(document.createElement("textarea"), { value: text }); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); try { ok = document.execCommand("copy"); } catch (e2) { ok = false; } ta.remove();
  }
  const label = btn.textContent; btn.textContent = ok ? done : "Couldn't copy"; setTimeout(() => { btn.textContent = label; }, 1800);
}

export const storeGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
export const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
