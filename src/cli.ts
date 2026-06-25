#!/usr/bin/env node
// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import Module from "node:module";

// ============================================================================
// 1. VS Code Module Mock
// ============================================================================
const mockVscode = {
  window: {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: (msg: string) => {
      console.error(`[Proxy Error] ${msg}`);
      return Promise.resolve();
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => defaultValue,
    }),
  },
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "vscode") return mockVscode;
  return originalRequire.call(this, id);
};

// ============================================================================
// Imports (Must be after the mock)
// ============================================================================
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as net from "node:net";
import * as child_process from "node:child_process";
import * as readline from "node:readline";
import chalk from "chalk";
import {
  startProxyServer,
  stopProxyServer,
} from "./server/index";
import { fetchModels } from "./api";
import { normalizeNvidiaModels } from "./model-catalog";
import type { NormalizedNvidiaModel } from "./model-catalog";
import {
  buildCustomModelOptions,
  getCurrentModel,
  resetCurrentModel,
} from "./model-switch";
import { getSessionStats } from "./dashboard";

// ============================================================================
// 2. Encryption & Key Storage
// ============================================================================
const KEY_FILE = path.join(os.homedir(), ".claude-nim-key");
const ALGORITHM = "aes-256-gcm";

function getMachineKey(): Buffer {
  const machineId = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.userInfo().username}`;
  return crypto.scryptSync(machineId, "claude-nim-salt", 32);
}

function encryptKey(apiKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getMachineKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: authTag.toString("hex"),
  });
}

function decryptKey(payload: string): string | null {
  try {
    const { iv, data, tag } = JSON.parse(payload);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getMachineKey(),
      Buffer.from(iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(data, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

function getStoredApiKey(): string | null {
  if (!fs.existsSync(KEY_FILE)) return null;
  const payload = fs.readFileSync(KEY_FILE, "utf8");
  return decryptKey(payload);
}

function saveApiKey(apiKey: string): void {
  const encrypted = encryptKey(apiKey);
  fs.writeFileSync(KEY_FILE, encrypted, { mode: 0o600 });
}

function clearApiKey(): void {
  try {
    if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE);
  } catch {
    // ignore
  }
}

// ============================================================================
// 3. Prompt Helpers
// ============================================================================
function promptForInput(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getOrPromptApiKey(cliArgKey?: string): Promise<string> {
  if (cliArgKey) {
    saveApiKey(cliArgKey);
    return cliArgKey;
  }

  const storedKey = getStoredApiKey();
  if (storedKey) return storedKey;

  console.log("\nNo NVIDIA NIM API key found.");
  console.log("Get your key securely from: https://build.nvidia.com/");
  const answer = await promptForInput("Enter your NVIDIA NIM API key: ");

  if (!answer) {
    console.error("API key is required to start.");
    process.exit(1);
  }

  saveApiKey(answer);
  console.log(" API key securely encrypted and stored locally.\n");
  return answer;
}

// ============================================================================
// 4. Claude CLI Detection
// ============================================================================
function isClaudeInstalled(): boolean {
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    child_process.execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureClaudeInstalled(): Promise<void> {
  if (isClaudeInstalled()) return;

  console.warn("⚠️  Claude Code CLI is not installed globally.");
  const answer = await promptForInput(
    "Would you like to install it now via bun? (y/N): ",
  );
  if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
    console.log("Installing @anthropic-ai/claude-code globally via bun...");
    try {
      child_process.execSync("bun install -g @anthropic-ai/claude-code", {
        stdio: "inherit",
      });
      console.log("✅ Claude Code installed successfully.\n");
    } catch {
      console.error(
        "❌ Failed to install Claude Code. Please install it manually:",
      );
      console.error("bun install -g @anthropic-ai/claude-code");
      process.exit(1);
    }
  } else {
    console.error("Cannot proceed without Claude Code. Exiting.");
    process.exit(1);
  }
}

// ============================================================================
// 5. Dynamic Port Binding
// ============================================================================
function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const fallbackServer = net.createServer();
      fallbackServer.listen(0, "127.0.0.1", () => {
        const port = (fallbackServer.address() as net.AddressInfo).port;
        fallbackServer.close(() => resolve(port));
      });
    });
  });
}

// ============================================================================
// 6. Child Process & Process Lifecycle Management
// ============================================================================
let claudeProcess: child_process.ChildProcess | null = null;
let isCleaningUp = false;

function cleanupAndExit() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  resetCurrentModel();
  stopProxyServer();

  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const cfg = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      delete cfg.model;
      fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2), "utf8");
    }
  } catch {
    // ignore
  }

  try {
    const stats = getSessionStats();
    const minutes = Math.floor(stats.uptimeMs / 60000);
    const seconds = Math.floor((stats.uptimeMs % 60000) / 1000);
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    const model = getCurrentModel() || "";

    const lavender = chalk.hex("#9B7BF0");
    const redish = chalk.bold.hex("#FF6B6B");
    const label = chalk.hex("#B388FF");
    const value = chalk.bold.hex("#FFFFFF");
    const dimLabel = chalk.hex("#7C5CBF");

    const W = 40;
    const hLine = lavender("\u2501".repeat(W));
    const innerW = W - 4;
    const left = `  ${lavender("\u2503")}  `;
    const right = `  ${lavender("\u2503")}`;
    const row = (l: string, v: string) => {
      const pad = innerW - l.length - v.length;
      return `${left}${label(l)}${pad > 0 ? " ".repeat(pad) : " ".repeat(2)}${value(v)}${right}`;
    };

    console.log();
    console.log(`  ${lavender("\u250F")}${hLine}${lavender("\u2513")}`);
    console.log(
      `${left}${redish("\u25C9  SESSION COMPLETE")}${" ".repeat(innerW - 19)}${right}`,
    );
    console.log(
      `  ${lavender("\u2523")}${lavender("\u2500".repeat(W))}${lavender("\u252B")}`,
    );
    if (model) {
      const m =
        model.length > innerW - 7 ? model.slice(0, innerW - 10) + "..." : model;
      console.log(
        `${left}${dimLabel("Model")}${" ".repeat(innerW - 5 - m.length)}${lavender(m)}${right}`,
      );
    }
    console.log(row("Requests", stats.requests.toString()));
    console.log(row("Tokens", stats.tokens.toLocaleString()));
    console.log(row("Duration", timeStr));
    console.log(`  ${lavender("\u2517")}${hLine}${lavender("\u251B")}`);
    console.log();
  } catch {
    // Ignore error
  }

  if (claudeProcess && !claudeProcess.killed) {
    try {
      if (process.platform === "win32") {
        child_process.execSync(`taskkill /pid ${claudeProcess.pid} /T /F`, {
          stdio: "ignore",
        });
      } else {
        claudeProcess.kill("SIGKILL");
      }
    } catch {
      // Ignore
    }
  }
  process.exit(0);
}

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);
process.on("exit", () => stopProxyServer());

// ============================================================================
// 7. Model Grouping
// ============================================================================

interface ModelGroup {
  family: string;
  models: NormalizedNvidiaModel[];
}

const FAMILY_ORDER = [
  "DeepSeek",
  "Gemma",
  "Llama",
  "Minimax",
  "Mistral",
  "Nemotron",
  "Phi",
  "Qwen",
  "Yi",
  "Claude",
  "GPT",
  "Other",
];

const FAMILY_RULES: [RegExp, string][] = [
  [/deepseek/, "DeepSeek"],
  [/gemma/, "Gemma"],
  [/llama/, "Llama"],
  [/nemotron/, "Nemotron"],
  [/mistral|mixtral/, "Mistral"],
  [/minimax/, "Minimax"],
  [/qwen|qwq/, "Qwen"],
  [/phi/, "Phi"],
  [/yi(?![a-z])/, "Yi"],
  [/claude/, "Claude"],
  [/gpt/, "GPT"],
  [/jamba/, "Jamba"],
  [/dbrx/, "DBRX"],
  [/starcoder/, "Starcoder"],
  [/command-r/, "Command-R"],
  [/falcon/, "Falcon"],
  [/solar/, "Solar"],
  [/codegeex/, "CodeGeeX"],
  [/seed/, "Seed"],
  [/sea-lion/, "Sea-Lion"],
  [/fuyu/, "Fuyu"],
  [/deplot/, "DePlot"],
  [/kosmos/, "Kosmos"],
  [/olmo/, "OLMo"],
  [/c4ai/, "C4AI"],
  [/aya/, "Aya"],
  [/bloom/, "BLOOM"],
  [/nvidia/, "NVIDIA"],
  [/google/, "Google"],
  [/microsoft/, "Microsoft"],
  [/meta/, "Meta"],
  [/anthropic/, "Anthropic"],
];

function getModelFamily(model: NormalizedNvidiaModel): string {
  const id = model.id.toLowerCase();
  for (const [regex, family] of FAMILY_RULES) {
    if (regex.test(id)) return family;
  }
  return "Other";
}

function groupModelsByFamily(models: NormalizedNvidiaModel[]): ModelGroup[] {
  const groups = new Map<string, NormalizedNvidiaModel[]>();
  for (const m of models) {
    const family = getModelFamily(m);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family)!.push(m);
  }

  const sorted: ModelGroup[] = [];
  const seen = new Set<string>();
  for (const name of FAMILY_ORDER) {
    if (groups.has(name)) {
      sorted.push({ family: name, models: groups.get(name)! });
      seen.add(name);
    }
  }
  for (const [name, list] of groups) {
    if (!seen.has(name)) {
      sorted.push({ family: name, models: list });
      seen.add(name);
    }
  }
  return sorted;
}

// ============================================================================
// 8. Interactive Sessions
// ============================================================================
interface HistoryItem {
  sessionId: string;
  timestamp: number;
  display: string;
  project: string;
}

function readClaudeHistory(): HistoryItem[] {
  const historyPath = path.join(os.homedir(), ".claude", "history.jsonl");
  if (!fs.existsSync(historyPath)) return [];
  try {
    const lines = fs.readFileSync(historyPath, "utf8").split("\n");
    const sessions = new Map<string, HistoryItem>();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.sessionId && parsed.display && parsed.timestamp) {
          if (!sessions.has(parsed.sessionId)) {
            sessions.set(parsed.sessionId, {
              sessionId: parsed.sessionId,
              timestamp: parsed.timestamp,
              display: parsed.display,
              project: parsed.project || "",
            });
          } else {
            const existing = sessions.get(parsed.sessionId)!;
            if (parsed.timestamp > existing.timestamp) {
              existing.timestamp = parsed.timestamp;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    return Array.from(sessions.values()).sort(
      (a, b) => b.timestamp - a.timestamp,
    );
  } catch {
    return [];
  }
}

async function runApiKeyMenu(): Promise<void> {
  const existing = getStoredApiKey();

  console.log("\n--- API Key Management ---");
  if (existing) {
    const masked = existing.slice(0, 4) + "****" + existing.slice(-4);
    console.log(` Current key: ${masked}`);
  } else {
    console.log(" No API key stored.");
  }

  const choice = await promptForInput(
    "\nEnter a new key to update, type 'clear' to remove, or press Enter to go back: ",
  );

  if (choice.toLowerCase() === "clear") {
    clearApiKey();
    console.log(" API key cleared.");
  } else if (choice) {
    saveApiKey(choice);
    console.log(" API key saved.");
  }
}

async function runModelSelection(apiKey: string): Promise<string> {
  console.log("\n  Fetching available NIM models...");
  try {
    const rawModels = await fetchModels(apiKey);
    if (!rawModels || rawModels.length === 0) {
      throw new Error("No models returned");
    }
    const models = normalizeNvidiaModels(rawModels);
    const groups = groupModelsByFamily(models);

    if (groups.length === 0) {
      throw new Error("No model groups");
    }

    const { renderListMenu } = await import("./cli-menu");
    const selectedGroup = await renderListMenu(
      " Select a model family:",
      groups,
      (g) => `${g.family} (${g.models.length} models)`,
    );

    if (!selectedGroup) {
      return "meta/llama-3.3-70b-instruct";
    }

    const selectedModel = await renderListMenu(
      ` Select a model (${selectedGroup.family}):`,
      selectedGroup.models,
      (m) => `${m.displayName}`,
    );

    if (!selectedModel) {
      return "meta/llama-3.3-70b-instruct";
    }

    return selectedModel.id;
  } catch {
    console.log(
      "  Could not fetch models, defaulting to meta/llama-3.3-70b-instruct",
    );
    return "meta/llama-3.3-70b-instruct";
  }
}

async function runStartFlow(
  apiKey: string,
  port: number,
  resolvedModel: string,
  sessionId?: string,
): Promise<void> {
  const dashboardUrl = `http://127.0.0.1:${port}/dashboard`;
  console.log(`\n  Dashboard: ${dashboardUrl}`);
  console.log();

  console.log("Launching Claude Code terminal...\n");

  const envOptions = { ...process.env };
  delete envOptions.ANTHROPIC_AUTH_TOKEN;

  let customModelOption = buildCustomModelOptions([
    { id: resolvedModel, displayName: resolvedModel },
  ]);

  try {
    const rawModels = await fetchModels(apiKey);
    if (rawModels && rawModels.length > 0) {
      const models = normalizeNvidiaModels(rawModels);
      const activeIdx = models.findIndex((m) => m.id === resolvedModel);
      if (activeIdx > -1) {
        const [active] = models.splice(activeIdx, 1);
        models.unshift(active);
      } else {
        models.unshift({
          id: resolvedModel,
          displayName: resolvedModel,
          contextWindow: 128000,
        } as NormalizedNvidiaModel);
      }
      customModelOption = buildCustomModelOptions(models);
      console.log(
        `  Found ${models.length} NIM models for Claude Code picker.`,
      );
    }
  } catch {
    console.log(
      "  Could not fetch NIM models. Custom model picker unavailable.",
    );
  }

  const cmd = process.platform === "win32" ? "claude.cmd" : "claude";

  const args = [];
  if (sessionId) args.push("--resume", sessionId);

  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    let cfg: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      cfg = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    }
    if (resolvedModel) {
      cfg.model = resolvedModel;
      fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2), "utf8");
    }
  } catch {
    // ignore
  }

  claudeProcess = child_process.spawn(cmd, args, {
    stdio: "inherit",
    shell: true,
    env: {
      ...envOptions,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: apiKey,
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
      ANTHROPIC_CUSTOM_MODEL_OPTION: customModelOption,
    },
  });

  claudeProcess.on("exit", (code) => {
    console.log(
      `\nClaude Code exited (code ${code}). Shutting down proxy server...`,
    );
    cleanupAndExit();
  });
}

// ============================================================================
// 9. Main
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  let cliPort = 3456;
  let model: string | undefined = undefined;
  let cliApiKey: string | undefined = undefined;
  let debug = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) {
      cliPort = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--model" && args[i + 1]) {
      model = args[i + 1];
      i++;
    } else if (arg === "--api-key" && args[i + 1]) {
      cliApiKey = args[i + 1];
      i++;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--help" || arg === "-h") {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
      );
      console.log(`
Claude-NIM Proxy CLI v${pkg.version}
Usage: claude-nim [options]

Options:
  --port <number>     Preferred port (default: 3456, falls back to dynamic)
  --model <string>    Default model ID to use
  --api-key <string>  Your NVIDIA NIM API key
  --debug             Enable debug logging
  --version, -v       Show version
  --help              Show this help message
`);
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
      );
      console.log(pkg.version);
      process.exit(0);
    }
  }

  console.log();
  console.log("  " + "=".repeat(50));
  console.log("  " + "     Welcome to Claude-NIM Proxy");
  console.log("  " + "  Use Claude Code CLI with NVIDIA NIM");
  console.log("  " + "=".repeat(50));
  console.log();

  if (debug) {
    process.env.NVIDIA_NIM_DEBUG = "1";
  }

  // Non-interactive: --model provided, skip menus
  if (model) {
    await ensureClaudeInstalled();
    const apiKey = await getOrPromptApiKey(cliApiKey);
    const port = await findAvailablePort(cliPort);
    console.log(`\n  Proxy binding to port ${port} with model: ${model}\n`);
    try {
      await startProxyServer(port, apiKey, model);
    } catch (err) {
      console.error("Failed to start proxy server:", err);
      process.exit(1);
    }
    await runStartFlow(apiKey, port, model);
    return;
  }

  // Interactive menu loop
  const { renderMainMenu, renderListMenu } = await import("./cli-menu");

  while (true) {
    const choice = await renderMainMenu();

    if (!choice || choice === "Exit") {
      console.log("\nGoodbye!");
      cleanupAndExit();
      return;
    }

    if (choice === "API") {
      await runApiKeyMenu();
      console.log();
      continue;
    }

    let resumeSessionId: string | undefined = undefined;

    if (choice === "History") {
      const history = readClaudeHistory();
      if (history.length === 0) {
        console.log("\n  No previous Claude sessions found.\n");
        continue;
      }

      const selected = await renderListMenu(
        " Select a previous session to resume:",
        history.slice(0, 20),
        (h: HistoryItem) => {
          const date = new Date(h.timestamp).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          const text =
            h.display.length > 50
              ? h.display.substring(0, 47) + "..."
              : h.display;
          return `[${date}] ${text}`;
        },
      );

      if (!selected) {
        console.log();
        continue;
      }
      resumeSessionId = selected.sessionId;
    }

    // choice === "Start" or resumed via History
    await ensureClaudeInstalled();
    const apiKey = await getOrPromptApiKey(cliApiKey);

    let resolvedModel = model;
    if (!resolvedModel) {
      resolvedModel = await runModelSelection(apiKey);
    }

    const port = await findAvailablePort(cliPort);
    console.log(
      `\n  Proxy binding to port ${port} with model: ${resolvedModel}\n`,
    );

    try {
      await startProxyServer(port, apiKey, resolvedModel);
    } catch (err) {
      console.error("Failed to start proxy server:", err);
      process.exit(1);
    }

    await runStartFlow(apiKey, port, resolvedModel, resumeSessionId);
    return;
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  cleanupAndExit();
});
