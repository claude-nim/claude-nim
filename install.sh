#!/usr/bin/env bash
# Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
# Licensed under the MIT License - see LICENSE for details
#
# Claude-NIM Proxy — Universal Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/claude-server/claude-nim/main/install.sh | bash
#
# Options:
#   --binary    Force install from standalone binary instead of NPM/Bun

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

FORCE_BINARY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --binary) FORCE_BINARY=true; shift ;;
        *) echo -e "${RED}Unknown option: $1${RESET}"; exit 1 ;;
    esac
done

echo ""
echo -e "${CYAN}  Claude-NIM Proxy Installer${RESET}"
echo ""

HAS_BUN=false
HAS_NODE=false
command -v bun &>/dev/null && HAS_BUN=true
command -v npm &>/dev/null && HAS_NODE=true

if $FORCE_BINARY; then
    INSTALL_METHOD="binary"
    echo -e "  ${CYAN}Forced: standalone binary${RESET}"
elif $HAS_BUN; then
    INSTALL_METHOD="bun"
    echo -e "  ${CYAN}Detected: Bun${RESET}"
elif $HAS_NODE; then
    INSTALL_METHOD="npm"
    echo -e "  ${CYAN}Detected: Node.js (npm)${RESET}"
else
    INSTALL_METHOD="binary"
    echo -e "  ${YELLOW}No JS runtime found — using standalone binary${RESET}"
fi
echo ""

BIN_DIR="$HOME/.local/bin"
TARGET_BIN=""

case "$INSTALL_METHOD" in
    bun)
        echo -e "${DIM}Installing via bun...${RESET}"
        bun install -g claude-nim
        TARGET_BIN="$(command -v claude-nim || echo "$HOME/.bun/bin/claude-nim")"
        ;;
    npm)
        echo -e "${DIM}Installing via npm...${RESET}"
        npm install -g claude-nim
        TARGET_BIN="$(command -v claude-nim || echo "$(npm prefix -g)/bin/claude-nim")"
        ;;
    binary)
        mkdir -p "$BIN_DIR"
        OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
        case "$OS" in
            linux*)  BIN_NAME="claude-nim" ;;
            darwin*) BIN_NAME="claude-nim-mac" ;;
            *)       echo -e "${RED}Unsupported OS: $OS${RESET}"; exit 1 ;;
        esac
        TARGET_BIN="$BIN_DIR/claude-nim"
        URL="https://github.com/claude-server/claude-nim/releases/latest/download/$BIN_NAME"
        echo -e "${DIM}Downloading standalone binary...${RESET}"
        curl -fsSL "$URL" -o "$TARGET_BIN" || { echo -e "${RED}Download failed${RESET}"; exit 1; }
        chmod +x "$TARGET_BIN"
        if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
            export PATH="$BIN_DIR:$PATH"
            PROFILE=""
            [[ "$SHELL" == *"zsh"* ]] && PROFILE="$HOME/.zshrc"
            [[ "$SHELL" == *"bash"* ]] && PROFILE="$HOME/.bashrc"
            if [[ -n "$PROFILE" ]]; then
                echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$PROFILE"
                echo -e "${YELLOW}Restart your terminal or run: source $PROFILE${RESET}"
            fi
        fi
        ;;
esac

# Case-insensitive aliases
mkdir -p "$BIN_DIR"
ln -sf "$TARGET_BIN" "$BIN_DIR/claude-nim"
ln -sf "$TARGET_BIN" "$BIN_DIR/Claude-nim"
ln -sf "$TARGET_BIN" "$BIN_DIR/Claude-Nim"
ln -sf "$TARGET_BIN" "$BIN_DIR/CLAUDE-NIM"

# Check Claude CLI
echo ""
if ! command -v claude &>/dev/null; then
    echo -e "${YELLOW}Claude Code CLI not found.${RESET}"
    read -rp "Install Claude Code now? (Y/n) " ans
    if [[ "${ans:-Y}" != "n" ]]; then
        if $HAS_BUN; then
            bun install -g @anthropic-ai/claude-code
        elif $HAS_NODE; then
            npm install -g @anthropic-ai/claude-code
        else
            echo -e "${RED}Cannot install without Node/Bun${RESET}"
        fi
    fi
fi

echo ""
echo -e "${GREEN}Installation complete!${RESET}"
echo -e "  Run: ${CYAN}claude-nim${RESET}"
echo ""
