<#
.SYNOPSIS
  Installs Claude-NIM Proxy.

.DESCRIPTION
  Auto-detects: Bun > npm > Standalone Binary.

.PARAMETER Binary
  Force standalone binary install.

.EXAMPLE
  iex (irm https://raw.githubusercontent.com/claude-server/claude-nim/main/install.ps1)

.EXAMPLE
  .\install.ps1 -Binary
#>
param([switch]$Binary)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Claude-NIM Proxy Installer" -ForegroundColor Cyan
Write-Host ""

$hasBun  = [bool](Get-Command "bun" -ErrorAction SilentlyContinue)
$hasNode = [bool](Get-Command "npm" -ErrorAction SilentlyContinue)

if ($Binary) {
    $method = "binary"
    Write-Host "  Forced: standalone binary" -ForegroundColor Cyan
} elseif ($hasBun) {
    $method = "bun"
    Write-Host "  Detected: Bun" -ForegroundColor Cyan
} elseif ($hasNode) {
    $method = "npm"
    Write-Host "  Detected: Node.js (npm)" -ForegroundColor Cyan
} else {
    $method = "binary"
    Write-Host "  No JS runtime — using standalone binary" -ForegroundColor Yellow
}
Write-Host ""

switch ($method) {
    "bun" {
        Write-Host "  Installing via bun..." -ForegroundColor DarkGray
        bun install -g claude-nim
        if ($LASTEXITCODE -ne 0) { Write-Host "  Failed" -ForegroundColor Red; exit 1 }
    }
    "npm" {
        Write-Host "  Installing via npm..." -ForegroundColor DarkGray
        npm install -g claude-nim
        if ($LASTEXITCODE -ne 0) { Write-Host "  Failed" -ForegroundColor Red; exit 1 }
    }
    "binary" {
        $binDir = Join-Path $env:LOCALAPPDATA "Claude-nim\bin"
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null
        $exePath = Join-Path $binDir "claude-nim.exe"
        $url = "https://github.com/claude-server/claude-nim/releases/latest/download/claude-nim.exe"
        Write-Host "  Downloading binary..." -ForegroundColor DarkGray
        try { Invoke-WebRequest -Uri $url -OutFile $exePath -UseBasicParsing }
        catch { Write-Host "  Download failed" -ForegroundColor Red; exit 1 }
        $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($userPath -notmatch [regex]::Escape($binDir)) {
            [Environment]::SetEnvironmentVariable("PATH", "$userPath;$binDir", "User")
            $env:PATH = "$env:PATH;$binDir"
        }
    }
}

# Check Claude CLI
Write-Host ""
$hasClaude = Get-Command "claude" -ErrorAction SilentlyContinue
if (-not $hasClaude) { $hasClaude = Get-Command "claude.cmd" -ErrorAction SilentlyContinue }
if (-not $hasClaude) {
    Write-Host "  Claude Code CLI not found." -ForegroundColor Yellow
    $ans = Read-Host "  Install Claude Code now? (Y/n)"
    if ($ans -ne "n") {
        if ($hasBun) { bun install -g @anthropic-ai/claude-code }
        elseif ($hasNode) { npm install -g @anthropic-ai/claude-code }
        else { Write-Host "  Cannot install without Node/Bun" -ForegroundColor Red }
    }
}

Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "  Run: claude-nim" -ForegroundColor Cyan
Write-Host ""
