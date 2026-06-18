// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

const tsPlugin = require("typescript-eslint");
const prettierConfig = require("eslint-config-prettier");
const prettierPlugin = require("eslint-plugin-prettier/recommended");

module.exports = tsPlugin.config(
  {
    ignores: ["out/", "dist/", "node_modules/", "**/*.js", "**/*.mjs", "src/dashboard-assets.ts"],
  },
  ...tsPlugin.configs.recommended,
  prettierConfig,
  prettierPlugin,
  {
    rules: {
      "@typescript-eslint/no-require-imports": "warn",
    },
  },
);
