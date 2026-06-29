const { readFileSync, writeFileSync, existsSync } = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");
const src = (p) => join(ROOT, p);

const files = {
  html: src("src/dashboard/dashboard.html"),
  js: src("src/dashboard/dashboard-client.js"),
};

for (const [key, path] of Object.entries(files)) {
  if (!existsSync(path)) {
    console.error(`Missing ${key} source: ${path}`);
    process.exit(1);
  }
}

const html = readFileSync(files.html, "utf8");
const js = readFileSync(files.js, "utf8");

const output = `// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Run 'npm run precompile' to rebuild.

export const DASHBOARD_HTML = ${JSON.stringify(html)};

export const DASHBOARD_JS = ${JSON.stringify(js)};
`;

writeFileSync(src("src/dashboard/dashboard-assets.ts"), output);
console.log("Inlined dashboard assets → src/dashboard/dashboard-assets.ts");
