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

export const ExtensionContext = {};

export const ConfigurationTarget = { Global: 1, Workspace: 2 };
