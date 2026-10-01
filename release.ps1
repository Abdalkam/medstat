param(
    [string]$Message = "auto-release $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
)

 $ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  SmartPages RELEASE (Tauri)" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Git ──
Write-Host "[1/3] Git sync..." -ForegroundColor Yellow
 $dirty = git status --porcelain 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }
if (-not $dirty) {
    Write-Host "  Nothing to commit." -ForegroundColor Green
} else {
    git add -A
    git commit -m $Message
    git push origin main 2>&1 | Out-Null
    Write-Host "  Committed & pushed." -ForegroundColor Green
}
git pull origin main --rebase 2>&1 | Out-Null

# ── 2. Build frontend ──
Write-Host "[2/3] Building frontend..." -ForegroundColor Yellow
npm run build 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) { Write-Host "  FAILED." -ForegroundColor Red; exit 1 }
Write-Host "  Done." -ForegroundColor Green

# ── 3. Tauri .exe ──
Write-Host "[3/3] Packaging .exe..." -ForegroundColor Yellow
npx tauri build 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -eq 0) {
    $exe = Get-ChildItem -Path "src-tauri\target\release\bundle" -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Host "  Done." -ForegroundColor Green
    if ($exe) { Write-Host "  EXE: $($exe.FullName)" -ForegroundColor Cyan }
} else {
    Write-Host "  FAILED." -ForegroundColor Red; exit 1
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "  RELEASE COMPLETE" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""