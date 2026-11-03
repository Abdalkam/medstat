[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Message = "release update",
  [switch]$BumpPatch,
  [switch]$SkipBuild,
  [switch]$NoDeploy
)

 $ErrorActionPreference = "Stop"

function Fail([string]$msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red;   exit 1 }
function Step([string]$msg) { Write-Host "==> $msg"  -ForegroundColor Cyan }
function Ok  ([string]$msg) { Write-Host "[ok]  $msg"  -ForegroundColor Green }

if (-not (Test-Path "package.json")) { Fail "package.json not found - run from project root" }
if (-not (Test-Path ".git"))         { Fail "not a git repository" }

 $branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -notin @("main", "master")) {
  Write-Host "[warn] on branch '$branch', not main/master" -ForegroundColor Yellow
}
if (-not (Test-Path "vercel.json")) {
  Write-Host "[warn] vercel.json missing - SPA routes will 404 on refresh" -ForegroundColor Yellow
}
 $hasVercel = $null -ne (Get-Command vercel -ErrorAction SilentlyContinue)
if (-not $hasVercel -and -not $NoDeploy) {
  Write-Host "[warn] vercel CLI not found - git push only" -ForegroundColor Yellow
}

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

if ($BumpPatch) {
  Step "npm version patch"
  npm version patch --no-git-tag-version
  if ($LASTEXITCODE -ne 0) { Fail "npm version failed" }
  git add package.json package-lock.json
  git commit -m "chore: bump version"
}

if (-not $SkipBuild) {
  Step "npm install"
  npm install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }

  Step "npm run build"
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail "build failed - release aborted (nothing pushed)" }
  Ok "build succeeded"
}

 $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
 $tag = "v$version"
Step "tagging $tag"
git tag -f $tag

Step "git push"
git push
if ($LASTEXITCODE -ne 0) { Fail "git push failed" }
git push origin $tag --force
Ok "pushed ($tag)"

if ($NoDeploy) { Ok "done - deploy skipped (-NoDeploy)"; exit 0 }

if ($hasVercel) {
  Step "vercel --prod"
  vercel --prod
  if ($LASTEXITCODE -ne 0) { Fail "vercel deploy failed" }
  Ok "deployed to production"
} else {
  Ok "Vercel will auto-deploy if repo is git-connected"
}