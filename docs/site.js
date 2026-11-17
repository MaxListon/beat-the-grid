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

  // Theme button: a sun or moon icon instead of the word "Theme"
  const ICONS = {
    moon: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z" fill="currentColor"/></svg>',
    sun: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8"/></g></svg>',
  };
  const isDark = () => (root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  function paintThemeBtn() {
    if (!btn) return;
    const dark = isDark();
    btn.innerHTML = dark ? ICONS.sun : ICONS.moon;          // shows what you'll switch to
    btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    btn.title = btn.getAttribute("aria-label");
    btn.classList.add("icon-btn");
  }
  paintThemeBtn();
  document.addEventListener("themechange", paintThemeBtn);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintThemeBtn);

  // Phone menu: below 900px the menu links are hidden, so a "Sections" button opens them (on the main page, every section)
  const navrow = document.querySelector(".navrow");
  if (navrow) {
    const toc = document.querySelector(".toc");
    const links = toc ? [...toc.querySelectorAll("a")] : [...document.querySelectorAll(".navlinks a")];
    const menuBtn = document.createElement("button");
    menuBtn.type = "button"; menuBtn.className = "ghost menu-btn"; menuBtn.id = "menuBtn";
    menuBtn.setAttribute("aria-expanded", "false"); menuBtn.setAttribute("aria-controls", "menuPanel");
    menuBtn.innerHTML = '<span>Sections</span><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const panel = document.createElement("nav");
    panel.id = "menuPanel"; panel.className = "menu-panel"; panel.hidden = true; panel.setAttribute("aria-label", "Sections");
    panel.innerHTML = links.map((a, i) => `<a href="${a.getAttribute("href")}"><span>${String(i + 1).padStart(2, "0")}</span>${a.textContent}</a>`).join("");
    navrow.insertBefore(menuBtn, btn || null);
    navrow.parentElement.appendChild(panel);
    const close = (focus) => { panel.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); if (focus) menuBtn.focus(); };
    menuBtn.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open));
      if (open) panel.querySelector("a").focus();
    });
    panel.addEventListener("click", (e) => { if (e.target.closest("a")) close(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) close(true); });
    document.addEventListener("click", (e) => { if (!panel.hidden && !panel.contains(e.target) && !menuBtn.contains(e.target)) close(false); });
  }

  // Reading progress line under the menu, and a back-to-top button once you're well down a long page
  const nav = document.querySelector(".topnav");
  if (nav) {
    const bar = document.createElement("div");
    bar.className = "progress"; bar.setAttribute("aria-hidden", "true");
    nav.appendChild(bar);
    const top = document.createElement("a");
    top.href = "#top"; top.className = "to-top"; top.setAttribute("aria-label", "Back to top"); top.hidden = true;
    top.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (!document.getElementById("top")) top.href = "#main";
    document.body.appendChild(top);
    let ticking = false;
    const update = () => {
      ticking = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
      top.hidden = scrollY < innerHeight * 1.5;
    };
    addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener("resize", update);
    update();
  }

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
