/* Shared by every page: theme toggle, privacy notice, optional cookieless analytics. */
(function () {
  "use strict";
  const cfg = window.SITE_CONFIG || {};
  const root = document.documentElement;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  // Theme (a display preference kept in your browser only; not a cookie)
  const saved = store.get("btg-theme");
  if (saved) root.setAttribute("data-theme", saved);
  const btn = document.getElementById("themeBtn");
  if (btn) btn.addEventListener("click", () => {
    const cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    store.set("btg-theme", next);
    document.dispatchEvent(new CustomEvent("themechange"));
  });

  // Privacy notice: informational only, because the site sets no cookies and has nothing to consent to
  if (!store.get("btg-notice")) {
    const bar = document.createElement("div");
    bar.className = "notice";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Privacy notice");
    bar.innerHTML = `<p>This site uses no cookies and no advertising trackers.${cfg.goatcounter ? " Visits are counted anonymously, without cookies." : ""} <a href="privacy.html">Privacy policy</a></p><button type="button" class="btn small">Got it</button>`;
    bar.querySelector("button").addEventListener("click", () => { store.set("btg-notice", "1"); bar.remove(); });
    document.body.appendChild(bar);
  }

  // Analytics: GoatCounter (cookieless, no personal data). Loads only if configured.
  if (cfg.goatcounter && /^[a-z0-9-]+$/.test(cfg.goatcounter)) {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://gc.zgo.at/count.js";
    s.dataset.goatcounter = `https://${cfg.goatcounter}.goatcounter.com/count`;
    document.head.appendChild(s);
  }
})();
