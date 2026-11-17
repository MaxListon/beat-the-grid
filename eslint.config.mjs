// ESLint for the website's JavaScript (docs/) and the browser tests. Run: npm run lint
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["docs/js/**/*.js", "docs/sql.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.browser, d3: "readonly", topojson: "readonly" } },
  },
  {
    files: ["docs/site.js", "docs/contact.js", "docs/config.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
  },
  { files: ["tests/e2e/**/*.mjs"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ["docs/js/**/*.js"], rules: { "no-shadow": ["error", { builtinGlobals: false }] } },   // e.g. a local `st` hiding the shared state
  { rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }], "no-empty": ["error", { allowEmptyCatch: true }] } },
];
