param(
    [string]$Message = ""
)

Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ── Auto-bump version ──
 $confPath = "src-tauri\tauri.conf.json"
 $confRaw = Get-Content $confPath -Raw
if ($confRaw -match '"version"\s*:\s*"(\d+\.\d+\.\d+)"') {
    $currentVersion = $Matches[1]
    $parts = $currentVersion.Split(".")
    $parts[2] = [int]$parts[2] + 1
    $newVersion = $parts -join "."
    $confRaw = $confRaw -replace "(?<=`"version`"\s*:\s*`")\d+\.\d+\.\d+", $newVersion
    Set-Content $confPath -Value $confRaw -NoNewline -Encoding UTF8
} else {
    Write-Host "Could not find version in tauri.conf.json" -ForegroundColor Red
    exit 1
}

 $pkgPath = "package.json"
 $pkgRaw = Get-Content $pkgPath -Raw
 $pkgRaw = $pkgRaw -replace "(?<=`"version`"\s*:\s*`")\d+\.\d+\.\d+", $newVersion
Set-Content $pkgPath -Value $pkgRaw -NoNewline -Encoding UTF8

 $cargoPath = "src-tauri\Cargo.toml"
 $cargoRaw = Get-Content $cargoPath -Raw
 $cargoRaw = $cargoRaw -replace "(?<=version\s*=\s*`")\d+\.\d+\.\d+", $newVersion
Set-Content $cargoPath -Value $cargoRaw -NoNewline -Encoding UTF8

if (-not $Message) { $Message = "Release SmartPages v$newVersion" }

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  SmartPages v$newVersion" -ForegroundColor Cyan
Write-Host "  (was v$currentVersion)" -ForegroundColor DarkGray
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Git ──
Write-Host "[1/3] Git sync..." -ForegroundColor Yellow
 $dirty = cmd /c "git status --porcelain"
if (-not $dirty) {
    Write-Host "  Nothing to commit." -ForegroundColor Green
} else {
    cmd /c "git add -A"
    cmd /c "git commit -m `"$Message`""
    cmd /c "git push origin main"
    Write-Host "  Committed & pushed." -ForegroundColor Green
}
cmd /c "git pull origin main --rebase"

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
    Write-Host "  Version: v$newVersion" -ForegroundColor Green
} else {
    Write-Host "  FAILED." -ForegroundColor Red; exit 1
}

# ── 4. Git tag ──
Write-Host "[extra] Tagging v$newVersion..." -ForegroundColor Yellow
cmd /c "git tag v$newVersion"
cmd /c "git push origin v$newVersion"

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "  RELEASE COMPLETE  v$newVersion" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""