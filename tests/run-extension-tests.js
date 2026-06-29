#!/usr/bin/env node
// Runs VS Code Extension Host integration tests using @vscode/test-electron
const { runTests } = require("@vscode/test-electron");
const path = require("path");

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "..");
    const extensionTestsPath = path.resolve(__dirname, "extension.test");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ["--disable-extensions"],
    });
  } catch (err) {
    console.error("Extension tests failed:", err);
    process.exit(1);
  }
}

main();
