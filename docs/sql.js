/* "Query the data yourself": DuckDB running in the visitor's browser over the site's Parquet files.
 * The engine (~7 MB) is downloaded only when someone runs a query. Parquet is read with HTTP range
 * requests, so a query fetches only the columns and row groups it needs. */
const DUCKDB = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
const TABLES = ["hourly", "regions", "peaks"];
const SHOW_ROWS = 500;

const PRESETS = [
  ["Worst 10 days for PJM", `-- My model's 10 worst days in PJM, the largest US grid
SELECT local_date,
       round(avg(abs(ours_mw - actual_mw) / actual_mw) * 100, 2)     AS my_error_pct,
       round(avg(abs(official_mw - actual_mw) / actual_mw) * 100, 2) AS official_error_pct
FROM hourly
WHERE region = 'PJM'
GROUP BY local_date
ORDER BY my_error_pct DESC
LIMIT 10;`],
  ["Error by hour of day", `-- Average error by local hour, in the strict check (official median error under 5%)
SELECT local_hour,
       round(avg(abs(ours_mw - actual_mw) / actual_mw) * 100, 2)     AS my_error_pct,
       round(avg(abs(official_mw - actual_mw) / actual_mw) * 100, 2) AS official_error_pct
FROM hourly
JOIN regions USING (region)
WHERE in_strict_check
GROUP BY local_hour
ORDER BY local_hour;`],
  ["Who wins each month", `-- Demand-weighted error each month: total miss / total demand
SELECT strftime(local_date, '%Y-%m') AS month,
       round(sum(abs(ours_mw - actual_mw)) / sum(actual_mw) * 100, 2)     AS my_error_pct,
       round(sum(abs(official_mw - actual_mw)) / sum(actual_mw) * 100, 2) AS official_error_pct,
       round(sum(abs(blend_mw - actual_mw)) / sum(actual_mw) * 100, 2)    AS blend_error_pct
FROM hourly
JOIN regions USING (region)
WHERE in_headline
GROUP BY month
ORDER BY month;`],
  ["Texas summer afternoons", `-- ERCOT (Texas), June to August, 2 pm to 7 pm local time
SELECT extract(year FROM local_date) AS year,
       count(*) AS hours,
       round(avg(abs(ours_mw - actual_mw) / actual_mw) * 100, 2)     AS my_error_pct,
       round(avg(abs(official_mw - actual_mw) / actual_mw) * 100, 2) AS official_error_pct,
       round(avg(actual_mw)) AS avg_demand_mw
FROM hourly
WHERE region = 'ERCO'
  AND extract(month FROM local_date) BETWEEN 6 AND 8
  AND local_hour BETWEEN 14 AND 19
GROUP BY year
ORDER BY year;`],
  ["Peak timing by region", `-- How often each forecast puts the daily peak within 1 hour of the real one
SELECT region, name,
       round(avg((abs(ours_peak_hour - actual_peak_hour) <= 1)::INT) * 100, 1)     AS my_hit_pct,
       round(avg((abs(official_peak_hour - actual_peak_hour) <= 1)::INT) * 100, 1) AS official_hit_pct,
       count(*) AS days
FROM peaks
JOIN regions USING (region)
WHERE in_headline
GROUP BY region, name, avg_demand_mw
ORDER BY avg_demand_mw DESC;`],
  ["Range calibration", `-- Does the 80% range hold 80% of outcomes in every region?
SELECT region,
       round(avg((actual_mw BETWEEN ours_low_mw AND ours_high_mw)::INT) * 100, 1) AS inside_range_pct,
       count(*) AS hours
FROM hourly
GROUP BY region
ORDER BY inside_range_pct;`],
];

const $ = (s) => document.querySelector(s);
const input = $("#sqlInput"), out = $("#sqlOut"), status = $("#sqlStatus"), runBtn = $("#sqlRun"), csvBtn = $("#sqlCsv");
let dbPromise = null, last = null;

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function setPreset(i) {
  input.value = PRESETS[i][1];
  document.querySelectorAll("#sqlPresets .chip").forEach((b, j) => b.setAttribute("aria-pressed", String(i === j)));
}

async function engine() {
  const duckdb = await import(DUCKDB);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = await db.connect();
  for (const t of TABLES) {
    const url = new URL(`data/sql/${t}.parquet`, location.href).href;
    await db.registerFileURL(`${t}.parquet`, url, duckdb.DuckDBDataProtocol.HTTP, false);
    await conn.query(`CREATE VIEW ${t} AS SELECT * FROM parquet_scan('${t}.parquet')`);
  }
  return conn;
}

// Arrow returns dates and timestamps as epoch milliseconds; format them by the column's type
const kindOf = (f) => { const t = String(f.type); return /^Date/i.test(t) ? "date" : /^Timestamp/i.test(t) ? "ts" : ""; };
const asTime = (v, kind) => {
  if (v == null || !kind) return v;
  const iso = new Date(typeof v === "bigint" ? Number(v) : +v).toISOString();
  return kind === "date" ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ") + " UTC";
};
function cell(v) {
  if (v == null) return "";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : (Math.abs(v) < 1 ? v.toPrecision(3) : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  return String(v);
}
function raw(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === "bigint" ? v.toString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function render(cols, rows, ms) {
  last = { cols, rows };
  const shown = rows.slice(0, SHOW_ROWS);
  out.innerHTML = rows.length
    ? `<table class="lb sql-table"><caption class="sr-only">Query results</caption><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
      shown.map((r) => `<tr>${r.map((v) => `<td${typeof v === "number" || typeof v === "bigint" ? ' class="num"' : ""}>${esc(cell(v))}</td>`).join("")}</tr>`).join("") + "</tbody></table>"
    : `<p class="note">The query ran but returned no rows.</p>`;
  status.textContent = `${rows.length.toLocaleString("en-US")} row${rows.length === 1 ? "" : "s"} in ${ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(1) + " s"}` +
    (rows.length > SHOW_ROWS ? `, showing the first ${SHOW_ROWS}` : "");
  csvBtn.hidden = !rows.length;
}

async function run() {
  const q = input.value.trim();
  if (!q) { status.textContent = "Type a query first."; return; }
  runBtn.disabled = true; status.classList.remove("bad");
  status.textContent = dbPromise ? "Running…" : "Loading the database engine (first run only)…";
  try {
    dbPromise = dbPromise || engine();
    const conn = await dbPromise;
    status.textContent = "Running…";
    const t0 = performance.now();
    const res = await conn.query(q);
    const fields = res.schema.fields, cols = fields.map((f) => f.name), kinds = fields.map(kindOf);
    const rows = res.toArray().map((r) => cols.map((c, i) => asTime(r[c], kinds[i])));
    render(cols, rows, performance.now() - t0);
  } catch (e) {
    if (String(e).includes("Failed to fetch") || String(e).includes("import")) dbPromise = null;   // let a retry reload the engine
    status.classList.add("bad");
    status.textContent = "Error: " + String(e.message || e).replace(/^Error:\s*/, "").split("\n")[0];
    out.innerHTML = ""; csvBtn.hidden = true;
  } finally { runBtn.disabled = false; }
}

function downloadCSV() {
  if (!last) return;
  const text = [last.cols.map(raw).join(","), ...last.rows.map((r) => r.map(raw).join(","))].join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "beat-the-grid_query.csv" });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#sqlPresets").innerHTML = PRESETS.map(([t], i) => `<button type="button" class="chip" aria-pressed="false" data-i="${i}">${esc(t)}</button>`).join("");
document.querySelectorAll("#sqlPresets .chip").forEach((b) => b.addEventListener("click", () => { setPreset(+b.dataset.i); run(); }));
setPreset(0);
runBtn.addEventListener("click", run);
csvBtn.addEventListener("click", downloadCSV);
input.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); } });
