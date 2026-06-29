// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
export const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showInputBox: jest.fn(),
  showQuickPick: jest.fn(),
  createOutputChannel: jest.fn().mockReturnValue({
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  }),
  createStatusBarItem: jest.fn().mockReturnValue({
    text: "",
    tooltip: "",
    command: "",
    backgroundColor: undefined,
    show: jest.fn(),
    dispose: jest.fn(),
  }),
  createTerminal: jest.fn().mockReturnValue({
    show: jest.fn(),
    sendText: jest.fn(),
    dispose: jest.fn(),
  }),
};

export const workspace = {
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn(),
    update: jest.fn(),
  }),
  onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
};

export const commands = {
  registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
};

export const StatusBarAlignment = { Right: 1, Left: 2 };

export class ThemeColor {
  constructor(public id: string) {}
}

export class ExtensionContext {
  subscriptions: { dispose: () => void }[] = [];
  extensionPath = "/mock/extension/path";
  extensionUri = { scheme: "file", path: "/mock/extension/path" };
  secrets = {
    get: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  };
  globalState = {
    get: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    keys: jest.fn().mockResolvedValue([]),
    setKeysForSync: jest.fn(),
  };
  workspaceState = {
    get: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    keys: jest.fn().mockResolvedValue([]),
  };
  extensionMode = 1;
  storagePath = "/mock/storage/path";
  globalStoragePath = "/mock/global-storage/path";
  logPath = "/mock/log/path";
  asAbsolutePath = jest.fn((p: string) => `/mock/extension/path/${p}`);
}

export const ConfigurationTarget = { Global: 1, Workspace: 2 };
