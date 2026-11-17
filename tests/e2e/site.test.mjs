/* Browser tests: drive real Chrome against the website in docs/, served locally the way GitHub Pages serves it.
 *   npm ci && npm run test:browser          (from the repo root; set CHROME_PATH if Chrome is elsewhere)
 * Every test also fails if the page throws a JavaScript error. */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, "../../docs");
const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}/beat-the-grid/`;
const CHROME = process.env.CHROME_PATH || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let server, browser;
before(async () => {
  const root = mkdtempSync(join(tmpdir(), "btg-site-"));
  symlinkSync(DOCS, join(root, "beat-the-grid"));                 // the site lives under /beat-the-grid/, as on GitHub Pages
  server = spawn("python3", [join(here, "serve.py"), String(PORT), root], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE)).ok) break; } catch (e) { /* not up yet */ } await wait(100); }
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(path = "", { width = 1366, dark = false } = {}) {
  const p = await browser.newPage();
  const phone = width < 600;
  await p.setViewport({ width, height: phone ? 844 : 900, isMobile: phone, hasTouch: phone });
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "reduce" }]);
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem("btg-notice", "1"); } catch (e) { /* ignore */ } });
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(BASE + path, { waitUntil: "networkidle0" });
  await wait(600);
  return p;
}
async function done(p) { const errs = p.errors; await p.close(); assert.deepEqual(errs, [], "page threw JavaScript errors"); }
const topOf = (p, id) => p.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top), id);

describe("navigation", () => {
  test("menu links land exactly on their section (after lazy charts draw)", async () => {
    const p = await open();
    for (const id of ["peaks", "sql", "live", "results"]) {
      await p.evaluate((id) => document.querySelector(`a[href="#${id}"]`).click(), id);
      await wait(900);
      assert.ok(Math.abs((await topOf(p, id)) - 72) <= 6, `#${id} landed at ${await topOf(p, id)}px`);
    }
    await done(p);
  });

  test("phone menu lists every section and closes after a jump", async () => {
    const p = await open("", { width: 390 });
    await p.tap("#menuBtn");
    assert.equal(await p.$eval("#menuPanel", (e) => e.hidden), false);
    assert.ok((await p.$$eval("#menuPanel a", (a) => a.length)) >= 12);
    await p.evaluate(() => [...document.querySelectorAll("#menuPanel a")].find((a) => a.getAttribute("href") === "#game").click());
    await wait(900);
    assert.equal(await p.$eval("#menuPanel", (e) => e.hidden), true);
    assert.ok(Math.abs((await topOf(p, "game")) - 72) <= 6);
    await done(p);
  });

  test("theme button switches theme and its label", async () => {
    const p = await open();
    const before = await p.$eval("#themeBtn", (e) => e.getAttribute("aria-label"));
    await p.click("#themeBtn");
    assert.notEqual(await p.$eval("#themeBtn", (e) => e.getAttribute("aria-label")), before);
    assert.ok(["dark", "light"].includes(await p.evaluate(() => document.documentElement.dataset.theme)));
    await done(p);
  });
});

describe("explorer", () => {
  test("a shared link opens that exact view, and the address follows changes", async () => {
    const p = await open("#explore?region=CISO&days=30&compare=NEVP");
    await wait(1200);
    assert.equal(await p.$eval("#regionSel", (e) => e.value), "CISO");
    assert.equal(await p.$eval("#compareSel", (e) => e.value), "NEVP");
    assert.equal(await p.$eval('#rangeSeg [aria-pressed="true"]', (e) => e.dataset.d), "30");
    assert.ok(Math.abs((await topOf(p, "explore")) - 72) <= 6);
    await p.click('#rangeSeg [data-d="7"]');
    assert.match(await p.evaluate(() => location.hash), /region=CISO&days=7&compare=NEVP/);
    await done(p);
  });

  test("find your grid: a state picks its region, explains the result, and is remembered", async () => {
    let p = await open("#explore");
    await p.select("#stateSel", "Ohio");
    await wait(300);
    assert.equal(await p.$eval("#regionSel", (e) => e.value), "PJM");
    assert.match(await p.$eval("#findOut", (e) => e.textContent), /Most of Ohio is served by PJM Interconnection/);
    await p.select("#stateSel", "Montana");
    assert.match(await p.$eval("#findOut", (e) => e.textContent), /isn't one of the 34 regions/);
    await p.select("#stateSel", "Texas");
    await done(p);
    p = await open();
    assert.equal(await p.$eval("#stateSel", (e) => e.value), "Texas");
    assert.equal(await p.$eval("#regionSel", (e) => e.value), "ERCO");
    await done(p);
  });

  test("jargon gets plain-language definitions on focus", async () => {
    const p = await open();
    assert.ok((await p.$$(".term")).length >= 5);
    await (await p.$(".term")).focus();
    await wait(100);
    assert.equal(await p.$eval("#tip", (e) => e.hidden), false);
    assert.ok((await p.$eval("#tip", (e) => e.textContent)).length > 40);
    await done(p);
  });
});

describe("the game", () => {
  test("keyboard play fills the day, reveal scores you against my model and the operator", async () => {
    const p = await open("#game");
    await p.focus("#gameChart");
    for (let i = 0; i < 23; i++) { await p.keyboard.press("ArrowUp"); await p.keyboard.press("ArrowRight"); }
    assert.equal(await p.$eval("#gameReveal", (e) => e.disabled), false);
    await p.click("#gameReveal");
    await wait(300);
    const scores = await p.$$eval(".game-score b", (b) => b.map((x) => x.textContent));
    assert.equal(scores.length, 3);
    scores.forEach((s) => assert.match(s, /^\d+\.\d%$/));
    assert.match(await p.$eval("#gameRecord", (e) => e.textContent), /1 day played/);
    await done(p);
  });

  test("drawing with a pointer works too", async () => {
    const p = await open("#game");
    await wait(1600);                       // after a jump the page holds the section in place for ~1.5 s; let that finish
    await p.evaluate(() => document.querySelector(".game-pad").scrollIntoView({ block: "center" }));
    await wait(200);
    const box = await p.$eval(".game-pad", (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await p.mouse.move(box.x + 4, box.y + box.h / 2);
    await p.mouse.down();
    for (let i = 1; i <= 24; i++) await p.mouse.move(box.x + 4 + (box.w - 16) * i / 24, box.y + box.h * (0.5 - 0.1 * Math.sin(i / 4)));
    await p.mouse.up();
    assert.equal(await p.$eval("#gameReveal", (e) => e.disabled), false);
    await done(p);
  });
});

describe("other pages and data", () => {
  test("SQL console runs a preset query in the browser (DuckDB over Parquet)", { timeout: 120000 }, async () => {
    const p = await open("#sql");
    await p.click('#sqlPresets .chip[data-i="0"]');
    await p.waitForFunction(() => /rows? in|Error/.test(document.getElementById("sqlStatus").textContent), { timeout: 110000 });
    assert.match(await p.$eval("#sqlStatus", (e) => e.textContent), /^10 rows in/);
    assert.equal(await p.$$eval("#sqlOut tbody tr", (r) => r.length), 10);
    await done(p);
  });

  test("the 404 page has lost power but still links home", async () => {
    const p = await open("404.html");
    assert.match(await p.$eval("h1", (e) => e.textContent), /lost power/);
    assert.equal(await p.$eval("#power", (e) => e.getAttribute("href")), "/beat-the-grid/");
    await done(p);
  });

  test("RSS feed is served and lists the live forecasts", async () => {
    const res = await fetch(BASE + "feed.xml");
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, /<rss version="2.0"/);
    assert.match(xml, /<item><title>Forecast for /);
  });

  test("every page loads without errors, light and dark", async () => {
    for (const path of ["", "writeup.html", "changelog.html", "privacy.html", "terms.html"]) {
      for (const dark of [false, true]) await done(await open(path, { dark }));
    }
  });
});
