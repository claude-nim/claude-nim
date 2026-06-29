// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

interface ModelOption {
  value: string;
  label: string;
  description: string;
}

export function buildCustomModelOptions(
  models: Array<{ id: string; displayName: string }>,
): string {
  const limited = models.slice(0, 30);
  const options: ModelOption[] = limited.map((m) => ({
    value: m.id,
    label: m.displayName,
    description: "NIM",
  }));
  return JSON.stringify(options);
}
