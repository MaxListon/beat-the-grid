/* Contact form: inline validation, two spam guards, then redirect to thanks.html.
 * Spam protection: (1) a hidden "website" honeypot field that people never see but bots fill in,
 * (2) a time trap: submissions sent less than 3 seconds after the page loads are dropped.
 * Formspree adds its own server-side spam filtering on top. */
(function () {
  "use strict";
  const cfg = window.SITE_CONFIG || {};
  const form = document.getElementById("contactForm");
  if (!form) return;
  const box = document.getElementById("contactBox");
  if (!cfg.formEndpoint) {
    box.innerHTML = `<p class="sub">The contact form isn't switched on yet. The fastest way to reach me is <a href="${cfg.linkedin}" rel="noopener">LinkedIn</a>.</p>`;
    return;
  }
  const loadedAt = Date.now();
  const status = document.getElementById("formStatus");
  const rules = {
    name: (v) => (v.trim().length >= 2 ? "" : "Please enter your name."),
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "Please enter a valid email address, like name@company.com."),
    message: (v) => (v.trim().length >= 20 ? "" : `Please write at least 20 characters (${v.trim().length} so far).`),
  };
  function check(field) {
    const err = rules[field.name] ? rules[field.name](field.value) : "";
    const out = document.getElementById(field.name + "Err");
    field.setAttribute("aria-invalid", err ? "true" : "false");
    if (out) out.textContent = err;
    return !err;
  }
  Object.keys(rules).forEach((n) => {
    const f = form.elements[n];
    f.addEventListener("blur", () => check(f));
    f.addEventListener("input", () => { if (f.getAttribute("aria-invalid") === "true") check(f); });
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fields = Object.keys(rules).map((n) => form.elements[n]);
    const ok = fields.map(check).every(Boolean);
    if (!ok) { fields.find((f) => f.getAttribute("aria-invalid") === "true").focus(); return; }
    if (form.elements.website.value || Date.now() - loadedAt < 3000) {   // bot: pretend success, send nothing
      location.href = "thanks.html"; return;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Sending…"; status.textContent = "";
    try {
      const r = await fetch(cfg.formEndpoint, {
        method: "POST", headers: { Accept: "application/json" }, body: new FormData(form),
      });
      if (!r.ok) throw new Error(r.status);
      location.href = "thanks.html";
    } catch (e) {
      status.textContent = "Sorry, that didn't send. Please try again, or message me on LinkedIn.";
      btn.disabled = false; btn.textContent = "Send message";
    }
  });
})();
