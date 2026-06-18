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

# ─── Colors ───────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── Parse Args ──────────────────────────────────────────
FORCE_BINARY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --binary) FORCE_BINARY=true; shift ;;
        *) echo -e "${RED}Unknown option: $1${RESET}"; exit 1 ;;
    esac
done

# ─── Banner ───────────────────────────────────────────────
echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════╗${RESET}"
echo -e "${CYAN}  ║      Claude-NIM Proxy Installer      ║${RESET}"
echo -e "${CYAN}  ╚══════════════════════════════════════╝${RESET}"
echo ""

# ─── Runtime Detection ───────────────────────────────────
HAS_BUN=false
HAS_NODE=false

if command -v bun &>/dev/null; then HAS_BUN=true; fi
if command -v npm &>/dev/null; then HAS_NODE=true; fi

INSTALL_METHOD="binary"

if $FORCE_BINARY; then
    echo -e "  ${CYAN}[+] Forced Standalone Binary Installation${RESET}"
elif $HAS_BUN; then
    echo -e "  ${CYAN}[+] Auto-detected Bun${RESET}"
    INSTALL_METHOD="bun"
elif $HAS_NODE; then
    echo -e "  ${CYAN}[+] Auto-detected Node.js (npm)${RESET}"
    INSTALL_METHOD="npm"
else
    echo -e "  ${YELLOW}[+] No JS runtime found. Falling back to Standalone Binary.${RESET}"
fi

echo ""

# ─── Installation Logic ───────────────────────────────────
BIN_DIR="$HOME/.local/bin"

if [[ "$INSTALL_METHOD" == "bun" ]]; then
    echo -e "${DIM}  Installing globally via bun...${RESET}"
    bun install -g claude-nim
    TARGET_BIN="$(command -v claude-nim || echo "$HOME/.bun/bin/claude-nim")"

elif [[ "$INSTALL_METHOD" == "npm" ]]; then
    echo -e "${DIM}  Installing globally via npm...${RESET}"
    npm install -g claude-nim
    TARGET_BIN="$(command -v claude-nim || echo "$(npm bin -g)/claude-nim")"

elif [[ "$INSTALL_METHOD" == "binary" ]]; then
    mkdir -p "$BIN_DIR"
    
    # Detect OS
    OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
    case "$OS" in
        linux*)  BIN_NAME="claude-nim" ;;
        darwin*) BIN_NAME="claude-nim-mac" ;;
        *)       echo -e "${RED}  ERROR: Unsupported OS for binary: $OS${RESET}"; exit 1 ;;
    esac
    
    TARGET_BIN="$BIN_DIR/claude-nim"
    DOWNLOAD_URL="https://github.com/claude-server/claude-nim/releases/latest/download/$BIN_NAME"
    
    echo -e "${DIM}  Downloading standalone binary...${RESET}"
    if ! curl -fsSL "$DOWNLOAD_URL" -o "$TARGET_BIN"; then
        echo -e "${RED}  ERROR: Failed to download binary. It might not be published yet.${RESET}"
        exit 1
    fi
    chmod +x "$TARGET_BIN"
    
    # Add to PATH if not present
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        echo -e "${DIM}  Adding $BIN_DIR to PATH...${RESET}"
        export PATH="$BIN_DIR:$PATH"
        
        # Try to permanently add to profile
        PROFILE_FILE=""
        if [[ "$SHELL" == *"zsh"* ]]; then PROFILE_FILE="$HOME/.zshrc"
        elif [[ "$SHELL" == *"bash"* ]]; then PROFILE_FILE="$HOME/.bashrc"
        fi
        
        if [[ -n "$PROFILE_FILE" ]]; then
            echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$PROFILE_FILE"
            echo -e "${YELLOW}  Note: Restart your terminal or run 'source $PROFILE_FILE' to update PATH.${RESET}"
        fi
    fi
fi

# ─── Create Case-Insensitive Symlinks ────────────────────
# Ensure users can type 'Claude-Nim' or 'Claude-nim' and it still works on Linux/macOS
echo -e "${DIM}  Creating case-insensitive aliases...${RESET}"
mkdir -p "$BIN_DIR"
ln -sf "$TARGET_BIN" "$BIN_DIR/claude-nim"
ln -sf "$TARGET_BIN" "$BIN_DIR/Claude-nim"
ln -sf "$TARGET_BIN" "$BIN_DIR/Claude-Nim"
ln -sf "$TARGET_BIN" "$BIN_DIR/CLAUDE-NIM"

# ─── Check Claude CLI ────────────────────────────────────
echo ""
if ! command -v claude &>/dev/null; then
    echo -e "${YELLOW}  Claude Code CLI not found.${RESET}"
    read -rp "  Install Claude Code now? (Y/n) " install_claude
    if [[ "${install_claude:-Y}" != "n" ]]; then
        if $HAS_BUN; then
            echo -e "${DIM}  Installing @anthropic-ai/claude-code via bun...${RESET}"
            bun install -g @anthropic-ai/claude-code
        elif $HAS_NODE; then
            echo -e "${DIM}  Installing @anthropic-ai/claude-code via npm...${RESET}"
            npm install -g @anthropic-ai/claude-code
        else
            echo -e "${RED}  ERROR: Cannot install Claude Code without Node/Bun. Please install manually.${RESET}"
        fi
    fi
    echo ""
fi

# ─── Finish ──────────────────────────────────────────────
echo -e "${GREEN}  ╔══════════════════════════════════════╗${RESET}"
echo -e "${GREEN}  ║  Installation Complete!              ║${RESET}"
echo -e "${GREEN}  ╚══════════════════════════════════════╝${RESET}"
echo ""
echo -e "${DIM}  You can now launch the proxy from anywhere by typing:${RESET}"
echo -e "    ${CYAN}> claude-nim${RESET}"
echo ""
echo -e "${DIM}  (Case-insensitive aliases like Claude-Nim are also supported!)${RESET}"
echo ""
