# Ensure we are in a Git repository
if (-not (Test-Path .git)) {
    Write-Host "❌ Not a git repository. Please run this in your project root." -ForegroundColor Red
    exit
}

# 1. Get current version from the latest Git tag (defaults to v1.0.0 if no tags exist)
 $latestTag = git describe --tags --abbrev=0 2>$null
if (-not $latestTag) {
    $currentVersion = "1.0.0"
    Write-Host "⚠️ No existing tags found. Starting at v1.0.0" -ForegroundColor Yellow
} else {
    $currentVersion = $latestTag.TrimStart('v')
    Write-Host "✅ Current Version: v$currentVersion" -ForegroundColor Green
}

# 2. Determine the bump type based on commit messages
 $bumpType = "patch"
if ($latestTag) {
    $commits = git log $latestTag..HEAD --pretty=format:"%s" 2>$null
    foreach ($msg in $commits) {
        if ($msg -match "#major") { $bumpType = "major"; break }
        if ($msg -match "#minor") { $bumpType = "minor" }
    }
}

# 3. Calculate the new version number
 $parts = $currentVersion.Split('.')
 $major = [int]$parts[0]
 $minor = [int]$parts[1]
 $patch = [int]$parts[2]

if ($bumpType -eq "major") {
    $major++; $minor = 0; $patch = 0
} elseif ($bumpType -eq "minor") {
    $minor++; $patch = 0
} else {
    $patch++
}

 $newVersionNumber = "$major.$minor.$patch"
 $newVersion = "v$newVersionNumber"
Write-Host "🚀 Bumping version ($bumpType) to: $newVersion" -ForegroundColor Cyan

# 4. Update all configuration files (Tauri, Package, and Cargo)
 $tauriConfPath = "src-tauri/tauri.conf.json"
if (Test-Path $tauriConfPath) {
    $content = Get-Content $tauriConfPath -Raw
    $content = $content -replace '"version"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+"', "`"version`": `"$newVersionNumber`""
    Set-Content -Path $tauriConfPath -Value $content
    Write-Host "⚙️ Updated tauri.conf.json to $newVersionNumber" -ForegroundColor DarkGray
}

if (Test-Path "package.json") {
    $content = Get-Content "package.json" -Raw
    $content = $content -replace '"version"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+"', "`"version`": `"$newVersionNumber`""
    Set-Content -Path "package.json" -Value $content
    Write-Host "⚙️ Updated package.json to $newVersionNumber" -ForegroundColor DarkGray
}

 $cargoPath = "src-tauri/Cargo.toml"
if (Test-Path $cargoPath) {
    $content = Get-Content $cargoPath -Raw
    $content = $content -replace '^version\s*=\s*"[0-9]+\.[0-9]+\.[0-9]+"', "version = `"$newVersionNumber`""
    Set-Content -Path $cargoPath -Value $content
    Write-Host "⚙️ Updated Cargo.toml to $newVersionNumber" -ForegroundColor DarkGray
}

# 5. Add, Commit, Tag, and Push
 $commitMessage = "Auto-version bump to $newVersion"
git add .
git commit -m "$commitMessage" --quiet

# SAFETY: Delete tag if it already exists locally and remotely
git tag -d $newVersion 2>$null
git push origin :refs/tags/$newVersion 2>$null

git tag -a $newVersion -m "$commitMessage"

Write-Host "☁️ Pushing to remote..." -ForegroundColor DarkGray
git push --follow-tags --quiet

if (!$?) {
    Write-Host "❌ Git push failed! Aborting build. Please check your internet connection or Git credentials." -ForegroundColor Red
    exit
}

Write-Host "`n🎉 Successfully updated to $newVersion!`n" -ForegroundColor Green

# ---------------------------------------------------------
# 6. Tauri Build Process
# ---------------------------------------------------------

# CLEAN OLD BUNDLES: Prevents the script from uploading old versions by mistake
Write-Host "🧹 Cleaning old build artifacts..." -ForegroundColor DarkGray
 $bundlePath = "src-tauri\target\release\bundle"
if (Test-Path $bundlePath) {
    Remove-Item $bundlePath -Recurse -Force
}

# Set environment variables for signing
 $env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\HP\.tauri\medstat_new.key"
 $securePassword = Read-Host "🔒 Enter your Tauri private key password (press Enter if blank)" -AsSecureString
 $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
 $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

Write-Host "🔨 Starting Tauri build..." -ForegroundColor Cyan
npm run tauri build

if (!$?) {
    Write-Host "`n❌ Build failed. Please check the errors above." -ForegroundColor Red
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    exit
}

# ---------------------------------------------------------
# 7. Auto-Upload to GitHub Releases
# ---------------------------------------------------------
Write-Host "📦 Uploading artifacts to GitHub Release $newVersion..." -ForegroundColor Cyan

# Dynamically search for the generated files
 $exePath = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" | Select-Object -First 1 -ExpandProperty FullName
 $sigPath = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.sig" | Select-Object -First 1 -ExpandProperty FullName
 $jsonPath = Get-ChildItem "src-tauri\target\release\bundle" -Filter "*.json" -Recurse | Where-Object { $_.Name -notlike "*build_hashes*" -and $_.Name -notlike "*.v1.json" } | Select-Object -First 1 -ExpandProperty FullName

# FALLBACK: If Tauri didn't generate latest.json, create it manually from the .sig file
if (!$jsonPath -and $exePath -and $sigPath) {
    Write-Host "⚠️ latest.json not found. Generating it manually from signature..." -ForegroundColor Yellow
    $signature = (Get-Content $sigPath -Raw).Trim()
    $jsonPath = "src-tauri\target\release\bundle\nsis\latest.json"
    $exeName = [System.IO.Path]::GetFileName($exePath)
    
    $jsonContent = @"
{
  "version": "$newVersionNumber",
  "notes": "Release $newVersion",
  "pub_date": "$(Get-Date -Format 'o')",
  "platforms": {
    "windows-x86_64": {
      "signature": "$signature",
      "url": "https://github.com/Abdalkam/medstat/releases/download/$newVersion/$exeName"
    }
  }
}
"@
    $jsonContent | Out-File -FilePath $jsonPath -Encoding utf8
}

# Upload to GitHub safely
if ($exePath -and $jsonPath) {
    gh release create $newVersion --title "$newVersion" --notes "Release $newVersion" $exePath $jsonPath
        
    if ($?) {
        Write-Host "`n✅ Release $newVersion published successfully! Auto-update is now live." -ForegroundColor Green
        Write-Host "View it at: https://github.com/Abdalkam/medstat/releases/tag/$newVersion" -ForegroundColor Cyan
    } else {
        Write-Host "`n❌ GitHub release creation failed. Make sure you ran 'gh auth login'." -ForegroundColor Red
    }
} else {
    Write-Host "❌ Could not find the .exe or .json files in the bundle folder." -ForegroundColor Red
}

# Clean up the password from memory for safety (will never throw an error)
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue