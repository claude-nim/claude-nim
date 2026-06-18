<#
.COPYRIGHT
Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
Licensed under the MIT License - see LICENSE for details

.SYNOPSIS
Installs Claude-NIM Proxy to your system.

.DESCRIPTION
Universal installer for Claude-NIM Proxy. Auto-detects the best available
installation method (Bun > Node > Standalone Binary). 

.PARAMETER Binary
  Force the installation of the standalone binary (Option B) even if Node/Bun is installed.

.EXAMPLE
  # Default — auto-detect, prefer NPM/Bun
  iex (irm https://raw.githubusercontent.com/claude-server/claude-nim/main/install.ps1)

.EXAMPLE
  # Force Standalone Binary download
  .\install.ps1 -Binary
#>
param(
    [switch]$Binary
)

$ErrorActionPreference = "Stop"

# ─── Banner ───────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║      Claude-NIM Proxy Installer      ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$hasBun  = [bool](Get-Command "bun"  -ErrorAction SilentlyContinue)
$hasNode = [bool](Get-Command "npm"  -ErrorAction SilentlyContinue)

# ─── Installation Logic ───────────────────────────────────

if ($Binary) {
    Write-Host "  [+] Forced Standalone Binary Installation" -ForegroundColor Cyan
    $installMethod = "binary"
} elseif ($hasBun) {
    Write-Host "  [+] Auto-detected Bun" -ForegroundColor Cyan
    $installMethod = "bun"
} elseif ($hasNode) {
    Write-Host "  [+] Auto-detected Node.js (npm)" -ForegroundColor Cyan
    $installMethod = "npm"
} else {
    Write-Host "  [+] No JS runtime found. Falling back to Standalone Binary." -ForegroundColor Yellow
    $installMethod = "binary"
}

Write-Host ""

if ($installMethod -eq "bun") {
    Write-Host "  Installing globally via bun..." -ForegroundColor DarkGray
    bun install -g claude-nim
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Failed to install via Bun." -ForegroundColor Red
        exit 1
    }
} elseif ($installMethod -eq "npm") {
    Write-Host "  Installing globally via npm..." -ForegroundColor DarkGray
    npm install -g claude-nim
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Failed to install via NPM." -ForegroundColor Red
        exit 1
    }
} elseif ($installMethod -eq "binary") {
    $binDir = Join-Path $env:LOCALAPPDATA "Claude-nim\bin"
    if (-not (Test-Path $binDir)) {
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    }
    
    $exePath = Join-Path $binDir "claude-nim.exe"
    $downloadUrl = "https://github.com/claude-server/claude-nim/releases/latest/download/claude-nim.exe"
    
    Write-Host "  Downloading standalone binary..." -ForegroundColor DarkGray
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $exePath -UseBasicParsing
    } catch {
        Write-Host "  ERROR: Failed to download binary from GitHub Releases. It might not be published yet." -ForegroundColor Red
        exit 1
    }
    
    # Add to User PATH if not exists
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notmatch [regex]::Escape($binDir)) {
        Write-Host "  Adding $binDir to User PATH..." -ForegroundColor DarkGray
        [Environment]::SetEnvironmentVariable("PATH", "$userPath;$binDir", "User")
        $env:PATH = "$env:PATH;$binDir"
    }
}

# ─── Check Claude CLI ────────────────────────────────────
Write-Host ""
$hasClaude = Get-Command "claude" -ErrorAction SilentlyContinue
if (-not $hasClaude) {
    $hasClaude = Get-Command "claude.cmd" -ErrorAction SilentlyContinue
}
if (-not $hasClaude) {
    Write-Host "  Claude Code CLI not found." -ForegroundColor Yellow
    $installClaude = Read-Host "  Install Claude Code now? (Y/n)"
    if ($installClaude -ne "n") {
        if ($hasBun) {
            Write-Host "  Installing @anthropic-ai/claude-code via bun..." -ForegroundColor DarkGray
            bun install -g @anthropic-ai/claude-code
        } elseif ($hasNode) {
            Write-Host "  Installing @anthropic-ai/claude-code via npm..." -ForegroundColor DarkGray
            npm install -g @anthropic-ai/claude-code
        } else {
            Write-Host "  ERROR: Cannot install Claude Code without Node/Bun. Please install manually." -ForegroundColor Red
        }
    }
    Write-Host ""
}

# ─── Finish ──────────────────────────────────────────────
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  Installation Complete!              ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  You can now launch the proxy from anywhere by typing:" -ForegroundColor White
Write-Host "    > claude-nim" -ForegroundColor Cyan
Write-Host ""
Write-Host "  (Note: Windows is case-insensitive, so Claude-Nim or CLAUDE-NIM will also work)" -ForegroundColor DarkGray
Write-Host ""
