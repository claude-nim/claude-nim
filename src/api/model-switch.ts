// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// State persistence (~/.claude-nim/state.json)
// ============================================================================

const DATA_DIR = path.join(os.homedir(), ".claude-nim");
const STATE_FILE = path.join(DATA_DIR, "state.json");

interface PersistedState {
  defaultModel: string;
  lastUpdated: number;
}

let currentModel = "";

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(
        fs.readFileSync(STATE_FILE, "utf8"),
      ) as PersistedState;
      currentModel = state.defaultModel || "";
    }
  } catch {
    /* ignore corrupt state */
  }
}

function saveState(): void {
  ensureDir();
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        defaultModel: currentModel,
        lastUpdated: Date.now(),
      },
      null,
      2,
    ),
  );
}

export function initModelState(): void {
  loadState();
}

export function getCurrentModel(): string {
  return currentModel;
}

export function setCurrentModel(model: string): void {
  currentModel = model;
  saveState();
}

export function resetCurrentModel(): void {
  currentModel = "";
  saveState();
}
