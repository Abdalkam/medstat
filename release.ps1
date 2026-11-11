# release.ps1  -  medstat release helper (ASCII-safe for PS 5.1)
# v3 - free-domain + blank-page guard:
#   - AppUrl now points at the free Vercel domain medstat-git-main-medstat.vercel.app
#     (medstat.vercel.app is owned by a DIFFERENT Vercel account - never use it)
#   - NEW post-deploy SPA shell check: verifies the JS bundle referenced by
#     index.html really comes back as application/javascript, not text/html
#     (this is exactly the blank-page bug class seen on fbd507b)
#   - vercel.json guard now accepts both rewrite shapes (with/without /medstat)
#   - v3.1 guards verify api/[...path].js and vercel.json are COMMITTED to git:
#     the 2026-11-11 adfdwp1m3 release served 404 on every /api/* route because
#     the api proxy was never part of the deployment (untracked/gitignored)
#   - v3.1 shell check uses /medstat WITHOUT trailing slash + HTTP status check
#     (routing configs exist where /medstat/ 404s while /medstat serves fine)
#   - still failover-aware: supabase.ts engine, api/[...path].js proxy,
#     health check of /medstat/api/health with Render cold-start retries
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Message = "release update",
  # Free Vercel domain: auto-aliases the latest production deploy from main.
  # The script pushes to main before deploying, so this URL always reflects
  # the code being released.
  [string]$AppUrl  = "https://medstat-git-main-medstat.vercel.app",
  [switch]$BumpPatch,
  [switch]$SkipBuild,
  [switch]$NoDeploy,
  [switch]$SkipHealthCheck,
  [switch]$SkipShellCheck
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

# v3.1: the proxy must also be COMMITTED - git deployments ship only tracked
# files, and CLI deploys skip anything .gitignore covers
$apiTracked = (git ls-files -- "api/") -join ";"
if ($apiTracked -notmatch "path") {
  Fail "api/[...path].js is NOT committed to git - deployments will ship with NO api proxy (this is what broke release adfdwp1m3). Run:  git add api  - if git add does not stage it, check .gitignore:  git check-ignore -v api/[...path].js"
}
Ok "api proxy is committed to git"

if (-not (Test-Path "vercel.json")) {
  Warn "vercel.json missing - SPA routes will 404 on refresh"
} elseif (-not ((Select-String -Path "vercel.json" -Pattern '"/api/:path\*"' -Quiet) -or
                (Select-String -Path "vercel.json" -Pattern '/medstat/api/:path\*"' -Quiet))) {
  Warn "vercel.json is v1 (no /api/:path* rewrite) - replace with vercel.json v2"
} else {
  Ok "vercel.json v2 present (api proxy rewrite)"
}

# v3 guard: the live fbd507b release shipped with NO /medstat/* rewrites, so
# /medstat/api/health and /medstat/assets/* both fell through to index.html
# (blank page + health check reading the SPA shell instead of JSON).
# v3.1: the adfdwp1m3 release HAD the asset rewrite but still no api rule.
if (Test-Path "vercel.json") {
  if (-not (Select-String -Path "vercel.json" -Pattern "/medstat" -Quiet)) {
    Warn "vercel.json has no /medstat/* rules - /medstat/assets will fall through to index.html (blank page)"
    Warn "add:  { \"source\": \"/medstat/:path*\", \"destination\": \"/:path*\" }  BEFORE the SPA fallback rewrite"
  }
  if (-not (Select-String -Path "vercel.json" -Pattern "/medstat/api" -Quiet)) {
    Warn "vercel.json has no /medstat/api rule - /medstat/api/health will return the SPA shell instead of JSON (this is what broke release adfdwp1m3)"
    Warn "add as the FIRST rewrite:  { \"source\": \"/medstat/api/:path*\", \"destination\": \"/api/:path*\" }"
  }
  if (-not (git ls-files -- vercel.json)) {
    Warn "vercel.json is NOT committed to git - the git deployment will keep the OLD routing. Run:  git add vercel.json"
  }
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

$health = ""
$healthy = $false
if ($SkipHealthCheck) {
  Ok "health check skipped (-SkipHealthCheck)"
  $healthy = $true   # do not block the shell check / release message on it
} else {
  Step "health check: $healthUrl"
  for ($i = 1; $i -le 4; $i++) {
    $health = (curl.exe -s -m 70 $healthUrl) -join ""
    if ($LASTEXITCODE -eq 0 -and $health -match '"status"\s*:\s*"ok"') { $healthy = $true; break }
    Write-Host "      attempt ${i}: not ready yet - Render free tier can sleep (wake takes 30-60s), retrying in 15s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 15
  }

  if ($healthy) {
    Ok "API proxy verified end-to-end: $health"
  } else {
    Warn "health check did not pass after 4 attempts (last response: $health)"
    Warn "Render may still be waking up - the release itself is deployed."
    Warn ("verify manually in a minute:  curl.exe -s $healthUrl   (expect " + '{"status":"ok",...}' + ")")
    Warn "if the response above is index.html (<!DOCTYPE html>...) instead of JSON, either the /medstat/api rewrite is missing from vercel.json or api/[...path].js never made it into the deployment (it must be committed to git)"
  }
}

# --- 9. SPA shell check (v3) ----------------------------------------------------
# Catches the blank-page bug class: shell loads, but the JS bundle URL is
# answered with text/html (SPA fallback) instead of javascript. That is the
# exact failure seen on release fbd507b: vite base '/medstat/' but files
# served from '/', so /medstat/assets/* fell through the rewrites.
if ($SkipShellCheck) {
  Ok "shell check skipped (-SkipShellCheck)"
} else {
  Step "SPA shell check: $AppUrl/medstat"
  $shellCode = curl.exe -s -o NUL -w "%{http_code}" -m 30 "$AppUrl/medstat"
  $shellHtml = ""
  $m = $null
  if ("$shellCode" -ne "200") {
    Warn "shell at $AppUrl/medstat returned HTTP $shellCode (expected 200) - routing misconfigured on the deployment"
  } else {
    $shellHtml = (curl.exe -s -m 30 "$AppUrl/medstat") -join ""
    $m = [regex]::Match($shellHtml, '<script[^>]*type="module"[^>]*src="([^"]+)"')
    if (-not $m.Success) { $m = [regex]::Match($shellHtml, '<script[^>]*src="([^"]+)"') }
  }

  if ($m -and $m.Success) {
    $bundleUrl = $m.Groups[1].Value
    if ($bundleUrl -match '^https?://') {
      # already absolute - leave as-is
    } elseif ($bundleUrl.StartsWith("/")) {
      $bundleUrl = $AppUrl + $bundleUrl
    } else {
      $bundleUrl = "$AppUrl/medstat/" + $bundleUrl
    }

    $ct = (curl.exe -s -o NUL -w "%{content_type}" -m 30 $bundleUrl) -join ""
    if ($ct -match "javascript") {
      Ok "bundle served as JavaScript: $bundleUrl ($ct)"
    } else {
      Warn "BLANK PAGE RISK: bundle at $bundleUrl returned '$ct' instead of javascript"
      Warn "the browser will refuse to run it - users get an empty page. Add the /medstat/:path* rewrite to vercel.json (see warning in step 1) and re-release."
    }
  } else {
    Warn "no module <script> tag found in the shell at $AppUrl/medstat - inspect index.html manually"
  }
}

# --- wrap up ---------------------------------------------------------------------
if ($healthy) {
  Ok "release complete: $AppUrl/medstat"
} else {
  Warn "release deployed but the health check never passed - see warnings above"
}
