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
#   - v3.2: release 7b798ae shipped vercel.json v1 (root catch-all only) from a
#     second clone while the fixed file sat UNCOMMITTED on the first machine -
#     missing /medstat rules are now a HARD FAIL (override with -ForceRelease)
#   - v3.2: checks reordered - the SPA shell readiness POLL runs first and waits
#     up to ~3 min for the git build to go live; the old checks fired seconds
#     after push and always tested the PREVIOUS release
#   - v3.3 AUTO-FIX: if vercel.json lacks the /medstat rules (the 7b798ae bug -
#     a clone with the old v1 catch-all pushed over the fixed file), the script
#     backs it up (vercel.json.bak-*) and writes the canonical routing file
#     itself, so a stale v1 can never be pushed again
#   - v3.3 NEW -CliDeploy switch: deploy straight from this machine with
#     "npx vercel --prod", which works even when the Vercel<->GitHub
#     integration is dead (git build never fires). One-time setup:
#       npx vercel login
#       npx vercel link
#   - v3.3.1: auto-fix now MERGES - keeps the project's own framework /
#     buildCommand / outputDirectory keys (confirmed on the user's v1 file:
#     vite + "npm run build" + dist), replaces ONLY the rewrites array
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
  [switch]$SkipShellCheck,
  # v3.2: ship even when the vercel.json routing guards fail (not recommended)
  [switch]$ForceRelease,
  # v3.3: deploy from this machine with the vercel CLI (npx vercel --prod),
  # bypassing the Vercel<->GitHub integration entirely. One-time setup:
  #   npx vercel login
  #   npx vercel link
  [switch]$CliDeploy
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red;   exit 1 }
function Step([string]$msg) { Write-Host "==> $msg"  -ForegroundColor Cyan }
function Ok  ([string]$msg) { Write-Host "[ok]  $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }
# v3.2: routing guards can be overridden with -ForceRelease
function GuardFail([string]$msg) {
  if ($ForceRelease) { Warn "GUARD OVERRIDDEN by -ForceRelease: $msg" }
  else { Fail $msg }
}

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

# v3.3 AUTO-FIX: release 7b798ae shipped because a clone with the OLD v1
# vercel.json (root catch-all only) pushed over the fixed file. If the
# /medstat rules are missing, back the file up and write the canonical
# routing ourselves - the app architecture (vite base '/medstat/', health
# at /medstat/api/*) depends on exactly these three rules, in this order.
$canonicalJson = @'
{
  "rewrites": [
    { "source": "/medstat/api/:path*", "destination": "/api/:path*" },
    { "source": "/medstat/:path*", "destination": "/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
'@
if (-not (Test-Path "vercel.json")) {
  Warn "vercel.json missing - writing the canonical routing file"
  $canonicalJson | Set-Content -Path "vercel.json" -Encoding ASCII
  Ok "vercel.json created with canonical routing"
} elseif (-not (Select-String -Path "vercel.json" -Pattern "/medstat" -Quiet)) {
  $bak = "vercel.json.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  Copy-Item "vercel.json" $bak
  # v3.3.1: MERGE, not replace - keep the project's own framework /
  # buildCommand / outputDirectory keys, swap ONLY the rewrites array.
  $fixed = $false
  try {
    $cfg = Get-Content "vercel.json" -Raw | ConvertFrom-Json
    $newRewrites = @(
      [pscustomobject]@{ source = "/medstat/api/:path*"; destination = "/api/:path*" },
      [pscustomobject]@{ source = "/medstat/:path*";     destination = "/:path*" },
      [pscustomobject]@{ source = "/(.*)";               destination = "/index.html" }
    )
    $cfg | Add-Member -MemberType NoteProperty -Name "rewrites" -Value $newRewrites -Force
    ($cfg | ConvertTo-Json -Depth 10) | Set-Content -Path "vercel.json" -Encoding ASCII
    $fixed = $true
  } catch {
    Write-Host "      could not parse vercel.json ($($_.Exception.Message)) - replacing it wholesale instead" -ForegroundColor Yellow
  }
  if (-not $fixed) {
    $canonicalJson | Set-Content -Path "vercel.json" -Encoding ASCII
  }
  Warn "vercel.json had NO /medstat rules (the 7b798ae blank-page bug) - AUTO-FIXED (rewrites merged, other keys preserved)"
  Write-Host "      old file backed up as $bak ; the fixed file will be committed in step 2" -ForegroundColor Yellow
  if (Test-Path ".gitignore") {
    if (-not (Select-String -Path ".gitignore" -Pattern "vercel\.json\.bak" -Quiet)) {
      Add-Content ".gitignore" "`nvercel.json.bak-*"
    }
  } else {
    "vercel.json.bak-*" | Set-Content ".gitignore" -Encoding ASCII
  }
}

# v3.2 routing guards: release 7b798ae shipped because these were only Warns.
# The whole architecture (vite base '/medstat/', health at /medstat/api/*)
# depends on these rules - without them every release is a blank page.
if (Test-Path "vercel.json") {
  if (-not (Select-String -Path "vercel.json" -Pattern "/medstat" -Quiet)) {
    GuardFail "vercel.json has no /medstat/* rules - /medstat/assets will fall through to index.html = BLANK PAGE (release 7b798ae shipped exactly this). Add:  { \"source\": \"/medstat/:path*\", \"destination\": \"/:path*\" }  BEFORE the SPA fallback rewrite"
  }
  if (-not (Select-String -Path "vercel.json" -Pattern "/medstat/api" -Quiet)) {
    GuardFail "vercel.json has no /medstat/api rule - /medstat/api/health returns the SPA shell instead of JSON. Add as the FIRST rewrite:  { \"source\": \"/medstat/api/:path*\", \"destination\": \"/api/:path*\" }"
  }
  if (-not (git ls-files -- vercel.json)) {
    GuardFail "vercel.json is NOT committed to git - the git deployment will keep the OLD routing (this is how 7b798ae shipped v1). Run:  git add vercel.json"
  }
  # v3.3: order guard - the catch-all must come AFTER the /medstat rules
  $lnApi = (Select-String -Path "vercel.json" -Pattern "/medstat/api" | Select-Object -First 1).LineNumber
  $lnAll = (Select-String -Path "vercel.json" -Pattern "/\(\.\*\)"  | Select-Object -First 1).LineNumber
  if ($lnAll -and $lnApi -and ($lnAll -lt $lnApi)) {
    GuardFail "vercel.json: the catch-all /(.*) rewrite comes BEFORE the /medstat rules - it swallows /medstat/assets and every route = BLANK PAGE. Reorder so /medstat/api and /medstat come first (or delete vercel.json and re-run this script to regenerate the canonical file)"
  }
  Ok "vercel.json routing guards passed"
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

# v3.3: optional CLI deploy straight from this machine - the only path that
# works when the Vercel<->GitHub integration is broken (git build never fires).
# One-time setup:  npx vercel login   then   npx vercel link
$linked    = Test-Path ".vercel\project.json"
$deployUrl = ""
if ($CliDeploy) {
  if (-not $linked) {
    Fail "-CliDeploy needs a one-time link first:  npx vercel login   then   npx vercel link   (the code is already pushed - fix the link and just re-run this script)"
  }
  $vcExe = ""; $vcPre = @()
  if ($hasVercel) { $vcExe = "vercel" }
  elseif (Get-Command npx -ErrorAction SilentlyContinue) { $vcExe = "npx"; $vcPre = @("vercel") }
  else { Fail "no vercel CLI and no npx found - install Node.js or run: npm i -g vercel" }
  $vcLabel = (@($vcExe) + $vcPre) -join " "
  Step "cli deploy: $vcLabel --prod"
  $vcArgs = $vcPre + @("--prod", "--yes")
  $eap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  $vcOut = (& $vcExe @vcArgs 2>&1) | Out-String
  $ErrorActionPreference = $eap
  if ($LASTEXITCODE -ne 0) { Write-Host $vcOut; Fail "vercel CLI deploy failed - see output above" }
  Write-Host $vcOut.TrimEnd()
  $mUrl = [regex]::Matches($vcOut, "https://[a-z0-9-]+\.vercel\.app") |
          Where-Object { $_.Value -notmatch "git-main" } |
          Select-Object -Last 1
  if ($mUrl) { $deployUrl = $mUrl.Value; Ok "fresh deployment: $deployUrl" }
} elseif ($hasVercel) {
  if ($linked) {
    Step "vercel --prod"
    $eap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $vcOut = (& vercel --prod --yes 2>&1) | Out-String
    $ErrorActionPreference = $eap
    if ($LASTEXITCODE -ne 0) { Write-Host $vcOut; Fail "vercel deploy failed" }
    Write-Host $vcOut.TrimEnd()
    Ok "deployed to production"
    $mUrl = [regex]::Matches($vcOut, "https://[a-z0-9-]+\.vercel\.app") |
            Where-Object { $_.Value -notmatch "git-main" } |
            Select-Object -Last 1
    if ($mUrl) { $deployUrl = $mUrl.Value }
  } else {
    Warn "vercel CLI present but project not linked (.vercel/project.json missing) - skipping CLI deploy"
    Warn "one-time:  vercel login ; vercel link   - then re-run with -CliDeploy to deploy without the git integration"
    Warn "release ships via the git push only; the readiness poll (step 8) waits for that build"
  }
} else {
  Warn "vercel CLI not found - release ships via the git push only; the readiness poll (step 8) will wait for that build to go live"
  Warn "if the git build never fires (integration broken), run once:  npx vercel login ; npx vercel link   - then re-release with -CliDeploy"
}

# --- 7b. verify the fresh CLI deployment immediately (v3.3) ---------------------
if ($deployUrl) {
  Step "fresh-deployment shell check: $deployUrl/medstat"
  $dHtml = (curl.exe -s -m 30 "$deployUrl/medstat") -join ""
  $dm = [regex]::Match($dHtml, '<script[^>]*src="([^"]+)"')
  if ($dm.Success) {
    $dBundle = $dm.Groups[1].Value
    if (-not $dBundle.StartsWith("http")) {
      if ($dBundle.StartsWith("/")) { $dBundle = $deployUrl + $dBundle }
      else { $dBundle = "$deployUrl/medstat/" + $dBundle }
    }
    $dct = (curl.exe -s -o NUL -w "%{content_type}" -m 30 $dBundle) -join ""
    if ($dct -match "javascript") { Ok "fresh deployment serves the bundle as JavaScript ($dct)" }
    else { Warn "fresh deployment bundle is '$dct' - routing is broken even on a CLI deploy?!" }
  } else {
    Warn "could not read a module script from the fresh deployment shell"
  }
}

# --- 8. deployment readiness: SPA shell poll (v3.2) -----------------------------
# The git build only STARTS after the push, and checks that run seconds later
# always test the PREVIOUS release (exactly what happened on 7b798ae).
# Poll until the live alias serves the bundle as JavaScript (max ~3 min).
$AppUrl = $AppUrl.TrimEnd("/")

$shellOk = $false
$bundleUrl = ""
if ($SkipShellCheck) {
  Ok "shell check skipped (-SkipShellCheck)"
  $shellOk = $true
} else {
  Step "SPA shell readiness poll: $AppUrl/medstat"
  for ($i = 1; $i -le 8; $i++) {
    $shellCode = curl.exe -s -o NUL -w "%{http_code}" -m 30 "$AppUrl/medstat"
    $m = $null
    if ("$shellCode" -eq "200") {
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
        $shellOk = $true
        break
      }
      Write-Host "      attempt ${i}: bundle still '$ct' - new build not live yet (queued/building/failed), retrying in 20s..." -ForegroundColor Yellow
    } else {
      Write-Host "      attempt ${i}: shell HTTP $shellCode / no module script - retrying in 20s..." -ForegroundColor Yellow
    }
    if ($i -lt 8) { Start-Sleep -Seconds 20 }
  }

  if (-not $shellOk) {
    Warn "shell still not serving JavaScript after ~3 minutes (last bundle checked: $bundleUrl)"
    Warn "likely causes:"
    Warn "  1. the git build is queued or FAILED - check Vercel dashboard -> Deployments (Source column = your repo)"
    Warn "  2. the pushed vercel.json still lacks the /medstat/:path* rewrite (v1 routing) - verify what GitHub HEAD has:  curl.exe -s https://raw.githubusercontent.com/<user>/<repo>/main/vercel.json"
    Warn "skipping the API health check - it cannot pass until routing serves the app"
  }
}

# --- 9. API health check (v2) ----------------------------------------------------
$healthUrl = "$AppUrl/medstat/api/health"

$health = ""
$healthy = $false
if (-not $shellOk) {
  # routing not live - the health check would only read the SPA shell (already warned above)
} elseif ($SkipHealthCheck) {
  Ok "health check skipped (-SkipHealthCheck)"
  $healthy = $true
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

# --- wrap up ---------------------------------------------------------------------
if ($deployUrl) { Ok "cli deployment live at $deployUrl/medstat (independent of the git integration)" }
if ($healthy) {
  Ok "release complete: $AppUrl/medstat"
} elseif ($shellOk) {
  Warn "routing is live but the health check never passed - see warnings above"
} else {
  Warn "release pushed but the deployment is NOT serving the app - see warnings above"
}
