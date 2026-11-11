# release.ps1  -  medstat release helper (ASCII-safe for PS 5.1)
# v2 - failover-aware:
#   - pre-flight guards: supabase.ts failover engine, api/[...path].js proxy,
#     vercel.json v2 (api rewrite) - so a broken state never ships
#   - post-deploy health check of /medstat/api/health (same-origin proxy),
#     with retries for Render free-tier cold starts
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Message = "release update",
  [string]$AppUrl  = "https://medstat-jjbyxyrdz-medstat.vercel.app",
  [switch]$BumpPatch,
  [switch]$SkipBuild,
  [switch]$NoDeploy,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red;   exit 1 }
function Step([string]$msg) { Write-Host "==> $msg"  -ForegroundColor Cyan }
function Ok  ([string]$msg) { Write-Host "[ok]  $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }

# --- 1. sanity checks -------------------------------------------------------
if (-not (Test-Path "package.json")) { Fail "package.json not found - run from project root" }
if (-not (Test-Path ".git"))         { Fail "not a git repository" }

# git must be able to operate here (catches 'dubious ownership' early)
git rev-parse --is-inside-work-tree > $null
if ($LASTEXITCODE -ne 0) {
  Fail "git cannot access this repository. If the error above says 'dubious ownership', run:  git config --global --add safe.directory F:/medstat (adjust path to what git printed)"
}
Ok "git repository accessible"

# failover guards (v2)
if (Test-Path "src\auth\supabase.ts") {
  if (-not (Select-String -Path "src\auth\supabase.ts" -Pattern "apiFetchAny" -Quiet)) {
    Fail "src/auth/supabase.ts is still the old version (no apiFetchAny) - copy the failover supabase.ts over it first"
  }
  Ok "supabase.ts failover engine present"
} else {
  Warn "src/auth/supabase.ts not found at expected path - skipping failover engine check"
}

if (-not (Test-Path -LiteralPath "api\[...path].js")) {
  Fail "api/[...path].js is missing - /medstat/api/* needs this proxy (save api-catchall-proxy.js as api/[...path].js, folder 'api' in repo root)"
}
Ok "api/[...path].js proxy present"

if (-not (Test-Path "vercel.json")) {
  Warn "vercel.json missing - SPA routes will 404 on refresh"
} elseif (-not (Select-String -Path "vercel.json" -Pattern '"/api/:path\*"' -Quiet)) {
  Warn "vercel.json is v1 (no /api/:path* rewrite) - replace with vercel.json v2"
} else {
  Ok "vercel.json v2 present (api proxy rewrite)"
}

$branch = ("$(git rev-parse --abbrev-ref HEAD)").Trim()
if ($LASTEXITCODE -ne 0) { Fail "git rev-parse failed - cannot read the current branch" }
if ($branch -notin @("main", "master")) {
  Warn "on branch '$branch', not main/master"
}
$hasVercel = $null -ne (Get-Command vercel -ErrorAction SilentlyContinue)
if (-not $hasVercel -and -not $NoDeploy) {
  Warn "vercel CLI not found - git push only"
}

# --- 2. commit pending changes ----------------------------------------------
$dirty = git status --porcelain
if ($dirty) {
  Step "committing: $Message"
  git add .
  git commit -m $Message
  if ($LASTEXITCODE -ne 0) { Fail "git commit failed" }
  Ok "committed"
} else {
  Ok "working tree clean"
}

# --- 3. optional version bump ------------------------------------------------
if ($BumpPatch) {
  Step "npm version patch"
  npm version patch --no-git-tag-version
  if ($LASTEXITCODE -ne 0) { Fail "npm version failed" }
  git add package.json package-lock.json
  git commit -m "chore: bump version"
}

# --- 4. install + build -------------------------------------------------------
if (-not $SkipBuild) {
  Step "npm install"
  npm install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }

  Step "npm run build"
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail "build failed - release aborted (nothing pushed)" }
  Ok "build succeeded"
}

# --- 5. tag -------------------------------------------------------------------
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
Step "tagging $tag"
git tag -f $tag
if ($LASTEXITCODE -ne 0) { Fail "git tag failed" }

# --- 6. push ------------------------------------------------------------------
Step "git push"
git push
if ($LASTEXITCODE -ne 0) { Fail "git push failed" }
git push origin $tag --force
if ($LASTEXITCODE -ne 0) { Fail "git tag push failed" }
Ok "pushed ($tag)"

# --- 7. deploy -----------------------------------------------------------------
if ($NoDeploy) { Ok "done - deploy skipped (-NoDeploy)"; exit 0 }

if ($hasVercel) {
  Step "vercel --prod"
  vercel --prod
  if ($LASTEXITCODE -ne 0) { Fail "vercel deploy failed" }
  Ok "deployed to production"
} else {
  Ok "Vercel will auto-deploy if repo is git-connected"
}

# --- 8. post-deploy health check (v2) ------------------------------------------
$AppUrl = $AppUrl.TrimEnd("/")
$healthUrl = "$AppUrl/medstat/api/health"

if ($SkipHealthCheck) { Ok "health check skipped (-SkipHealthCheck)"; exit 0 }

Step "health check: $healthUrl"
$health = ""
$healthy = $false
for ($i = 1; $i -le 4; $i++) {
  $health = (curl.exe -s -m 70 $healthUrl) -join ""
  if ($LASTEXITCODE -eq 0 -and $health -match '"status"\s*:\s*"ok"') { $healthy = $true; break }
  Write-Host "      attempt ${i}: not ready yet - Render free tier can sleep (wake takes 30-60s), retrying in 15s..." -ForegroundColor Yellow
  Start-Sleep -Seconds 15
}

if ($healthy) {
  Ok "API proxy verified end-to-end: $health"
  Ok "release complete: $AppUrl/medstat"
} else {
  Warn "health check did not pass after 4 attempts (last response: $health)"
  Warn "Render may still be waking up - the release itself is deployed."
  Warn ("verify manually in a minute:  curl.exe -s $healthUrl   (expect " + '{"status":"ok",...}' + ")")
}
