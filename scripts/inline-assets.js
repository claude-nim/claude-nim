const fs = require('node:fs');
const path = require('node:path');

const srcDir = path.join(__dirname, '..', 'src');
const htmlPath = path.join(srcDir, 'dashboard.html');
const jsPath = path.join(srcDir, 'dashboard-client.js');
const outPath = path.join(srcDir, 'dashboard-assets.ts');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

const tsContent = `// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Run 'npm run precompile' to rebuild.

export const DASHBOARD_HTML = ${JSON.stringify(htmlContent)};

export const DASHBOARD_JS = ${JSON.stringify(jsContent)};
`;

fs.writeFileSync(outPath, tsContent);
console.log('Successfully inlined dashboard assets into src/dashboard-assets.ts');
