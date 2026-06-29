#!/usr/bin/env node
const { build, context } = require("esbuild");
const { mkdirSync, statSync } = require("fs");

const OUT_DIR = "out";
const isWatch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["vscode"],
  minify: true,
  treeShaking: true,
  sourcemap: false,
  legalComments: "none",
};

const CLI_VSCODE_MOCK = `
var mockVscode = {
  window: {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: (msg) => { console.error("[Proxy Error] " + msg); return Promise.resolve(); },
  },
  workspace: {
    getConfiguration: () => ({ get: (_key, defaultValue) => defaultValue }),
  },
};
var Module = require("module");
var origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "vscode") return mockVscode;
  return origRequire.call(this, id);
};
`;

// Banner prepended AFTER vscode mock: auto-detect Bun vs Node.js.
// If Bun is not defined (running under Node.js), re-exec with Bun.
const CLI_BUN_DETECT = `
if (typeof Bun === "undefined") {
  var _cp = require("child_process");
  var _bun = "bun";
  try { _bun = _cp.execSync("where bun", { encoding: "utf8", stdio: ["pipe","pipe","pipe"] }).trim().split("\\n")[0]; } catch(e) { try { _bun = _cp.execSync("which bun", { encoding: "utf8", stdio: ["pipe","pipe","pipe"] }).trim().split("\\n")[0]; } catch(e2) { _bun = "bun"; } }
  try {
    _cp.execFileSync(_bun, [__filename].concat(process.argv.slice(2)), { stdio: "inherit" });
    process.exit(0);
  } catch(e) {
    console.error("\\nThis CLI requires the Bun runtime.");
    console.error("Install Bun: https://bun.sh\\n");
    process.exit(1);
  }
}
`;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const extensionConfig = {
    ...shared,
    entryPoints: ["src/extension/index.ts"],
    outfile: `${OUT_DIR}/extension.js`,
    drop: ["console"],
  };

  const cliConfig = {
    ...shared,
    entryPoints: ["src/cli/index.ts"],
    outfile: `${OUT_DIR}/cli.js`,
    banner: { js: CLI_VSCODE_MOCK + CLI_BUN_DETECT },
  };

  if (isWatch) {
    const [extCtx, cliCtx] = await Promise.all([
      context(extensionConfig),
      context(cliConfig),
    ]);
    await Promise.all([extCtx.watch(), cliCtx.watch()]);
    console.log("Watching for changes...");
    return;
  }

  const results = await Promise.allSettled([
    build(extensionConfig),
    build(cliConfig),
  ]);

  const failures = results
    .map((r, i) =>
      r.status === "rejected" ? `${["extension", "cli"][i]}: ${r.reason}` : null,
    )
    .filter(Boolean);

  if (failures.length > 0) {
    console.error(`Build failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }

  // Report bundle sizes
  for (const name of ["extension", "cli"]) {
    const size = statSync(`${OUT_DIR}/${name}.js`).size;
    const kb = (size / 1024).toFixed(1);
    console.log(`${name}.js: ${kb} KB`);
    if (name === "extension" && size > 512 * 1024) {
      console.warn(`Warning: extension bundle exceeds 512 KB (${kb} KB)`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
