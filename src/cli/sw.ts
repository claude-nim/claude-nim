#!/usr/bin/env node
// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

// Bun auto-installer wrapper.
// Runs under Node.js, checks if Bun is available, installs it if not,
// then re-execs the target script under Bun.

import { execSync, execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

function findBun(): string | null {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    return execSync(`${which} bun`, { encoding: "utf8" }).trim().split("\n")[0];
  } catch {
    return null;
  }
}

function getBunDir(): string {
  return path.join(os.homedir(), ".bun", "bin");
}

function getBunPath(): string {
  if (process.platform === "win32") {
    return "bun.exe";
  }
  return path.join(getBunDir(), "bun");
}

function installBun(): void {
  console.log("[sw] Bun not found. Installing Bun runtime...");

  if (process.platform === "win32") {
    execSync('powershell -c "irm bun.sh/install.ps1 | iex"', {
      stdio: "inherit",
      timeout: 120_000,
    });
  } else {
    execSync("curl -fsSL https://bun.sh/install | bash", {
      stdio: "inherit",
      timeout: 120_000,
      env: { ...process.env, BUN_INSTALL: getBunDir() },
    });
  }

  // Verify installation succeeded
  const bunPath = findBun() ?? getBunPath();
  if (!fs.existsSync(bunPath) && process.platform !== "win32") {
    throw new Error(
      `Bun installed but not found at ${bunPath}. ` +
        "Add ~/.bun/bin to your PATH.",
    );
  }
  console.log("[sw] Bun installed successfully.");
}

// ── Main ───────────────────────────────────────────────────────────────────

const targetScript = process.argv[2];
if (!targetScript) {
  console.error("Usage: sw.ts <script> [args...]");
  process.exit(1);
}

const targetArgs = process.argv.slice(3);

// Find or install Bun
let bunCmd = findBun();
if (!bunCmd) {
  try {
    installBun();
    bunCmd = findBun() ?? getBunPath();
  } catch (err) {
    console.error(
      `[sw] Failed to install Bun: ${err instanceof Error ? err.message : err}`,
    );
    console.error("[sw] Install Bun manually: https://bun.sh");
    process.exit(1);
  }
}

// Re-exec target script under Bun
try {
  execFileSync(bunCmd, [targetScript, ...targetArgs], { stdio: "inherit" });
} catch (err: unknown) {
  // execFileSync throws when the child exits non-zero; extract the code
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    process.exit((err as { status: number }).status);
  }
  console.error(
    `[sw] Failed to run Bun: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
}
