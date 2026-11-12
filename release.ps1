# release.ps1  -  medstat release helper (ASCII-safe for PS 5.1)
# v4 - FULL AUTO git + vercel, auto-generated vercel domains only (no domain name needed):
#   - git AUTO-SYNC: add/commit -> pull --rebase -> build -> tag -> push, and a
#     failed push retries ONCE after an automatic re-sync (survives releases
#     made from the other machine / second clone)
#   - vercel AUTO-DEPLOY: a CLI deploy ("vercel --prod") is now the DEFAULT
#     whenever the vercel CLI (or npx) is installed and the project is linked.
#     The script AUTO-LINKS non-interactively ("vercel link --yes --project
#     <name from package.json>") when you are logged in. The ONLY one-time
#     manual step left is:   npx vercel login   (vercel login is interactive)
#   - vercel AUTO-GENERATED domains: NO hardcoded app URL anymore. The script
#     reads the production aliases of the newest production deployment
#     (vercel ls / vercel inspect --json) and verifies the app on that URL.
#     Everything stays on the free *.vercel.app domains vercel auto-generates
#     (per-deployment URL + stable project domain) - nothing to buy or own.
#   - the alias picker never picks medstat.vercel.app (owned by a DIFFERENT
#     vercel account - never use it) and prefers the stable project domain
#     over the git-branch domains
#   - -AppUrl is now an OPTIONAL override (default: empty = auto-detect)
#   - kept from v3.x: failover guards, committed api/[...path].js check,
#     vercel.json auto-fix with merge (v3.3.1), routing order guard (v3.3),
#     SPA shell readiness poll first (v3.2), health check with Render
#     cold-start retries
#   history:
#     v3     free-domain + blank-page guard: SPA shell check verifies the JS
#            bundle comes back as application/javascript (fbd507b bug class);
#            vercel.json guard accepts both rewrite shapes
#     v3.1   guards verify api/[...path].js + vercel.json are COMMITTED to git
#            (adfdwp1m3 served 404 on every /api/* because the proxy was
#            untracked); shell check uses /medstat WITHOUT trailing slash
#     v3.2   missing /medstat rules = HARD FAIL (-ForceRelease overrides);
#            checks reordered: the readiness POLL runs first (up to ~3 min) so
#            the checks test the NEW release, not the previous one (7b798ae)
#     v3.3   vercel.json AUTO-FIX: backs up and writes the canonical routing;
#            -CliDeploy switch: deploy via "npx vercel --prod" when the
#            Vercel<->GitHub integration is dead
#     v3.3.1 auto-fix MERGES: keeps framework / buildCommand / outputDirectory
#            (vite + "npm run build" + dist), replaces ONLY the rewrites array
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Message = "release update",
  # v4: OPTIONAL override only. Leave empty (default) and the live URL is
  # auto-detected from vercel: every deployment gets a free auto-generated
  # *.vercel.app domain, plus a stable project domain - no custom domain.
  [string]$AppUrl  = "",
  [switch]$BumpPatch,
  [switch]$SkipBuild,
  [switch]$NoDeploy,
  [switch]$SkipHealthCheck,
  [switch]$SkipShellCheck,
  # v3.2: ship even when the vercel.json routing guards fail (not recommended)
  [switch]$ForceRelease,
  # v3.3: kept for compatibility - a CLI deploy from this machine is now the
  # DEFAULT whenever the vercel CLI is available and the project is linked
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

# --- vercel/git CLI plumbing (v4) ---------------------------------------------
# resolves the vercel CLI once: "vercel" (global install) or "npx vercel"
$script:VercelCmd = @()
if (Get-Command vercel -ErrorAction SilentlyContinue)  { $script:VercelCmd = @("vercel") }
elseif (Get-Command npx -ErrorAction SilentlyContinue) { $script:VercelCmd = @("npx", "vercel") }

function Invoke-Vercel([string[]]$VercelArgs) {
  # runs the vercel CLI (directly or via npx); returns $null when unavailable,
  # otherwise an object with ExitCode and Output. EAP=Continue so native
  # stderr can never abort the script.
  if ($script:VercelCmd.Count -eq 0) { return $null }
  $all  = @($script:VercelCmd) + $VercelArgs
  $exe  = $all[0]
  $rest = @()
  if ($all.Count -gt 1) { $rest = @($all | Select-Object -Skip 1) }
  $eap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out  = (& $exe @rest 2>&1) | Out-String
    $code = $LASTEXITCODE
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $eap
  }
  return [pscustomobject]@{ ExitCode = $code; Output = $out }
}

function Invoke-Git([string[]]$GitArgs) {
  # runs git with EAP=Continue so native stderr (progress, warnings) is
  # captured instead of aborting the script under $ErrorActionPreference=Stop
  $eap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out  = (& git @GitArgs 2>&1) | Out-String
    $code = $LASTEXITCODE
  } catch {
    return [pscustomobject]@{ ExitCode = 1; Output = "$_" }
  } finally {
    $ErrorActionPreference = $eap
  }
  return [pscustomobject]@{ ExitCode = $code; Output = $out }
}

function Get-JsonPart([string]$s) {
  # strips ANSI escape codes, then returns everything from the first { or [
  if (-not $s) { return "" }
  $s = $s -replace "$([char]27)\[[0-9;]*[A-Za-z]", ""
  $a = $s.IndexOf("[")
  $o = $s.IndexOf("{")
  if ($o -ge 0 -and ($a -lt 0 -or $o -lt $a)) { return $s.Substring($o) }
  if ($a -ge 0) { return $s.Substring($a) }
  return ""
}

function Get-StableAlias([string]$inspectJson) {
  # picks the best AUTO-GENERATED *.vercel.app production alias from
  # "vercel inspect --json" (the .alias array). Rules (v4):
  #   - never medstat.vercel.app (a DIFFERENT vercel account owns it)
  #   - prefer the stable project domain (no "-git-" segment)
  #   - else prefer a "-git-main-" branch domain, else any remaining alias
  $raw = @()
  try {
    $obj = (Get-JsonPart $inspectJson) | ConvertFrom-Json
    $alias = $obj.alias
    if (-not $alias -and $obj.aliases)    { $alias = $obj.aliases }
    if (-not $alias -and $obj.deployment) { $alias = $obj.deployment.alias }
    foreach ($a in @($alias)) {
      if (-not $a) { continue }
      if ($a -is [string]) { $raw += $a }
      else {
        $p = $a.PSObject.Properties |
             Where-Object { $_.Value -is [string] -and $_.Value -match "\.vercel\.app$" } |
             Select-Object -First 1
        if ($p) { $raw += $p.Value }
      }
    }
  } catch {}
  $cands = @($raw | ForEach-Object {
      $d = "$_".Trim()
      if ($d -match "^https?://") { $d = $d.Substring($d.IndexOf("://") + 3) }
      $d.TrimEnd("/").ToLower()
    } |
    Where-Object { $_ -match "\.vercel\.app$" -and $_ -ne "medstat.vercel.app" } |
    Select-Object -Unique)
  if ($cands.Count -eq 0) { return "" }
  $pick = @($cands | Where-Object { $_ -notmatch "-git-" } | Select-Object -First 1)
  if (-not $pick) { $pick = @($cands | Where-Object { $_ -match "-git-main-" } | Select-Object -First 1) }
  if (-not $pick) { $pick = @($cands | Select-Object -First 1) }
  return ("https://" + $pick[0])
}

function Get-LatestProdDeployment([string]$lsJson) {
  # newest READY production deployment from "vercel ls --json" output (v4)
  $url = ""
  try {
    $deps = (Get-JsonPart $lsJson) | ConvertFrom-Json
    if ($deps -isnot [System.Array]) { $deps = @($deps) }
    $prod = @($deps | Where-Object { $_.target -eq "production" -and $_.state -eq "READY" })
    if ($prod.Count -eq 0) { $prod = @($deps | Where-Object { $_.state -eq "READY" }) }
    $best = $prod |
            Sort-Object -Property { if ($_.created_at) { $_.created_at } elseif ($_.created) { $_.created } else { 0 } } -Descending |
            Select-Object -First 1
    if ($best -and $best.url) { $url = "$($best.url)".Trim() }
  } catch {}
  if ($url -and $url -notmatch "^https?://") { $url = "https://" + $url }
  return $url
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
# v4: CLI availability note (replaces the old $hasVercel check)
if ($script:VercelCmd.Count -eq 0 -and -not $NoDeploy) {
  Warn "vercel CLI not found (and no npx) - this release will ship via git push only"
  Warn "install Node.js (gives you npx) to unlock the automatic deploy + auto URL detection"
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

# --- 2b. auto-sync with remote (v4) ------------------------------------------
# releases can come from two different machines - pull --rebase keeps them in
# sync automatically instead of letting the push fail later
$up = Invoke-Git @("rev-parse", "--abbrev-ref", "@{u}")
if ($up.ExitCode -eq 0) {
  Step "git pull --rebase (auto-sync with remote)"
  $pull = Invoke-Git @("pull", "--rebase")
  if ($pull.Output.Trim()) { Write-Host $pull.Output.TrimEnd() }
  if ($pull.ExitCode -ne 0) {
    Invoke-Git @("rebase", "--abort") | Out-Null
    Fail "git pull --rebase failed (network, or local and remote diverged). Sync manually, then re-run this script"
  }
  Ok "in sync with remote"
} else {
  Warn "branch '$branch' has no upstream yet - skipping auto-sync (the first push needs:  git push -u origin $branch)"
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

# --- 6. push (v4: one automatic re-sync retry) ---------------------------------
Step "git push"
$pushed = $false
for ($i = 1; $i -le 2; $i++) {
  $push = Invoke-Git @("push")
  if ($push.Output.Trim()) { Write-Host $push.Output.TrimEnd() }
  if ($push.ExitCode -eq 0) { $pushed = $true; break }
  if ($i -eq 1) {
    Step "push failed - re-syncing with remote (pull --rebase) and retrying once"
    $up2 = Invoke-Git @("rev-parse", "--abbrev-ref", "@{u}")
    if ($up2.ExitCode -ne 0) {
      Fail "git push failed: branch '$branch' has no upstream - run once:  git push -u origin $branch"
    }
    $pull = Invoke-Git @("pull", "--rebase")
    if ($pull.ExitCode -ne 0) {
      Invoke-Git @("rebase", "--abort") | Out-Null
      Fail "could not auto-sync with remote (local and remote diverged). Resolve manually, then re-run this script"
    }
    $tg = Invoke-Git @("tag", "-f", $tag)   # rebase moved the branch - re-point the release tag
    if ($tg.ExitCode -ne 0) { Fail "git tag failed after re-sync" }
  }
}
if (-not $pushed) {
  Fail "git push failed after one automatic retry (if this branch has no upstream yet:  git push -u origin $branch)"
}
$tagPush = Invoke-Git @("push", "origin", $tag, "--force")
if ($tagPush.ExitCode -ne 0) { Fail "git tag push failed" }
Ok "pushed ($tag)"

# --- 7. deploy (v4: CLI deploy is the default; the git integration is backup) ---
if ($NoDeploy) { Ok "done - deploy skipped (-NoDeploy)"; exit 0 }

# v4 auto-link: when the CLI is installed and you are logged in, the project is
# linked non-interactively (one-time). The login itself cannot be automated.
$linked = Test-Path ".vercel\project.json"
if (-not $linked -and $script:VercelCmd.Count -gt 0) {
  Step "vercel auto-link (one-time, project name from package.json)"
  $who = Invoke-Vercel @("whoami")
  if ($who -and $who.ExitCode -eq 0) {
    $pkgName = ""
    try { $pkgName = (Get-Content package.json -Raw | ConvertFrom-Json).name } catch {}
    if ($pkgName) {
      $lnk = Invoke-Vercel @("link", "--yes", "--project", $pkgName)
      if ($lnk -and $lnk.ExitCode -eq 0 -and (Test-Path ".vercel\project.json")) {
        $linked = $true
        Ok "linked to vercel project '$pkgName'"
      } else {
        if ($lnk) { Write-Host $lnk.Output.TrimEnd() -ForegroundColor Yellow }
        Warn "auto-link failed - run once manually:  vercel link   (or:  npx vercel link)"
      }
    } else {
      Warn "package.json has no 'name' field - cannot auto-link; run once:  vercel link"
    }
  } else {
    Warn "vercel CLI is not logged in - run ONCE:  npx vercel login   then re-run this script"
    Warn "after that one-time login, linking + deploying + URL detection all run automatically"
  }
}

$deployUrl = ""
if ($script:VercelCmd.Count -gt 0 -and $linked) {
  Step "vercel CLI deploy (--prod) - independent of the Vercel<->GitHub integration"
  $dep = Invoke-Vercel @("--prod", "--yes")
  if (-not $dep) { Fail "vercel CLI could not run - check node.js / vercel installation" }
  Write-Host $dep.Output.TrimEnd()
  if ($dep.ExitCode -ne 0) { Fail "vercel CLI deploy failed - see output above" }
  $mUrl = [regex]::Matches($dep.Output, "https://[a-z0-9-]+\.vercel\.app") |
          Where-Object { $_.Value -notmatch "git-main" } |
          Select-Object -Last 1
  if ($mUrl) { $deployUrl = $mUrl.Value; Ok "fresh deployment: $deployUrl" }
} else {
  Warn "no vercel CLI / project not linked - release ships via the git push only"
  Warn "the readiness poll (step 8) waits for that git build; for the fully automatic path run once:  npx vercel login"
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

# --- 7c. resolve the live URL (v4: vercel auto-generated domains) ---------------
# No hardcoded domain: the stable *.vercel.app domain is read from vercel.
$liveUrl = ""
if ($AppUrl) {
  $liveUrl = $AppUrl.TrimEnd("/")
  Ok "live URL override (-AppUrl): $liveUrl"
} elseif ($script:VercelCmd.Count -gt 0 -and $linked) {
  $checkUrl = $deployUrl
  if (-not $checkUrl) {
    Step "auto-detect newest production deployment (vercel ls)"
    $ls = Invoke-Vercel @("ls", "--json")
    if ($ls) { $checkUrl = Get-LatestProdDeployment $ls.Output }
  }
  if ($checkUrl) {
    Step "auto-detect the stable vercel domain (vercel inspect)"
    $alias = ""
    $ins = Invoke-Vercel @("inspect", $checkUrl, "--json")
    if ($ins) { $alias = Get-StableAlias $ins.Output }
    if ($alias) { $liveUrl = $alias; Ok "stable vercel domain: $liveUrl" }
    else        { $liveUrl = $checkUrl; Ok "using the fresh deployment URL: $liveUrl" }
  } else {
    Warn "could not auto-detect a deployment URL (vercel ls found nothing usable)"
  }
} else {
  Warn "cannot auto-detect the live URL (no vercel CLI / project not linked)"
  Warn "one-time fix:  npx vercel login   (the script then links, deploys and detects everything automatically)"
  Warn "or pass the URL manually this once:  .\release.ps1 -AppUrl https://<project>-<team>.vercel.app"
}

# --- 8. deployment readiness: SPA shell poll (v3.2, v4) --------------------------
# Git builds only go live minutes after the push; CLI deploys alias instantly.
# Poll until the live URL serves the bundle as JavaScript (max ~3 min).
$shellOk = $false
$bundleUrl = ""
if (-not $liveUrl) {
  Warn "skipping the SPA shell poll - no live URL (see the step 7c warnings above)"
} elseif ($SkipShellCheck) {
  Ok "shell check skipped (-SkipShellCheck)"
  $shellOk = $true
} else {
  Step "SPA shell readiness poll: $liveUrl/medstat"
  for ($i = 1; $i -le 8; $i++) {
    $shellCode = curl.exe -s -o NUL -w "%{http_code}" -m 30 "$liveUrl/medstat"
    $m = $null
    if ("$shellCode" -eq "200") {
      $shellHtml = (curl.exe -s -m 30 "$liveUrl/medstat") -join ""
      $m = [regex]::Match($shellHtml, '<script[^>]*type="module"[^>]*src="([^"]+)"')
      if (-not $m.Success) { $m = [regex]::Match($shellHtml, '<script[^>]*src="([^"]+)"') }
    }
    if ($m -and $m.Success) {
      $bundleUrl = $m.Groups[1].Value
      if ($bundleUrl -match '^https?://') {
        # already absolute - leave as-is
      } elseif ($bundleUrl.StartsWith("/")) {
        $bundleUrl = $liveUrl + $bundleUrl
      } else {
        $bundleUrl = "$liveUrl/medstat/" + $bundleUrl
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
    Warn "  1. the git build is queued or FAILED - check the vercel dashboard -> Deployments"
    $originUrl = ""
    try { $originUrl = ("$(git remote get-url origin 2>$null)").Trim() } catch {}
    if ($originUrl -match "github\.com[:/](.+?)(\.git)?/?$") {
      Warn ("  2. the pushed vercel.json still lacks the /medstat/:path* rewrite (v1 routing) - check what GitHub HEAD has:  curl.exe -s https://raw.githubusercontent.com/" + $Matches[1] + "/main/vercel.json")
    } else {
      Warn "  2. the pushed vercel.json still lacks the /medstat/:path* rewrite (v1 routing)"
    }
    Warn "skipping the API health check - it cannot pass until routing serves the app"
  }
}

# --- 9. API health check (v2) ----------------------------------------------------
$healthUrl = "$liveUrl/medstat/api/health"

$health = ""
$healthy = $false
if (-not $shellOk) {
  # routing not live (or no live URL) - the health check would only read the SPA shell
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
if ($deployUrl) { Ok "fresh deployment live at $deployUrl/medstat" }
if ($liveUrl) {
  try { Set-Clipboard -Value "$liveUrl/medstat"; Ok "live URL copied to the clipboard" } catch {}
  if ($healthy) {
    Ok "release complete: $liveUrl/medstat"
  } elseif ($shellOk) {
    Warn "routing is live but the health check never passed - see warnings above"
  } else {
    Warn "release pushed but the deployment is NOT verified - see warnings above"
  }
} else {
  Warn "release pushed, but the live URL could not be auto-detected - see the step 7c warnings above"
}
