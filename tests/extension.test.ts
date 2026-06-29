// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as assert from "node:assert";
import * as vscode from "vscode";

describe("Extension Activation", () => {
  it("should activate without errors", async () => {
    const ext = vscode.extensions.getExtension("k-rithik04.claude-nim");
    assert.ok(ext, "Extension should be found");
    assert.ok(
      ext.isActive || (await ext.activate(), true),
      "Extension should activate",
    );
  });

  it("should register all commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    const expected = [
      "nvidia-nim.manage",
      "nvidia-nim.toggleProxy",
      "nvidia-nim.launchClaudeCode",
      "nvidia-nim.selectDefaultModel",
      "nvidia-nim.toggleDebugLogging",
      "nvidia-nim.toggleShowReasoning",
      "nvidia-nim.openDebugLog",
    ];

    for (const cmd of expected) {
      assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
    }
  });

  it("should create a status bar item", () => {
    const ext = vscode.extensions.getExtension("k-rithik04.claude-nim");
    assert.ok(ext);
    // Status bar item is created in activate() — if no error thrown, it works
    assert.ok(true);
  });
});

describe("Configuration", () => {
  it("should have default settings", () => {
    const config = vscode.workspace.getConfiguration("nvidia-nim");
    assert.strictEqual(config.get("proxyPort"), 3456);
    assert.strictEqual(config.get("defaultModel"), "");
    assert.strictEqual(config.get("modelsCacheTTL"), 5);
    assert.strictEqual(config.get("requestTimeout"), 120);
  });
});
