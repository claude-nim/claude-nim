<!--
  Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
  Licensed under the MIT License - see LICENSE for details
-->

# Changelog

All notable changes to the Claude-NIM Proxy extension will be documented in this file.

## [1.0.0] - 2025-01-01

### Added
- Initial release of Claude-NIM Proxy
- Anthropic Messages API to OpenAI-compatible translation layer
- Streaming and non-streaming request support
- 12 model-family adapters (DeepSeek, Kimi, GLM, Llama, Mistral, Qwen, Phi, Yi, Gemma, Nemotron, Claude, GPT)
- Embedded tool call parsing (OpenAI, DeepSeek, DSML formats)
- JSON repair for malformed model outputs
- Context pruning for large tool outputs
- Prompt injection scrubbing
- NVIDIA NIM model catalog with normalization
- VS Code status bar proxy indicator
- "Launch Claude Code with Proxy" command
- "Select Default Model" command with QuickPick UI
- "Toggle Show Reasoning" for chain-of-thought visibility
- Standalone CLI mode (`npx tsx src/cli.ts`)
- Exponential backoff retry with jitter and Retry-After support
- Stream idle timeout with dynamic scaling
- Graceful shutdown with AbortController tracking
