# Ensure we are in a Git repository
if (-not (Test-Path .git)) {
    Write-Host "ERROR: Not a git repository." -ForegroundColor Red
    exit
}

# 1. Get current version from the latest Git tag
 $latestTag = git describe --tags --abbrev=0 2>$null
if (-not $latestTag) {
    $currentVersion = "1.0.0"
    Write-Host "WARN: No existing tags found. Starting at v1.0.0" -ForegroundColor Yellow
} else {
    $currentVersion = $latestTag.TrimStart('v')
    Write-Host "Current Version: v$currentVersion" -ForegroundColor Green
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
Write-Host "Bumping version ($bumpType) to: $newVersion" -ForegroundColor Cyan

# 4. Update all configuration files
 $tauriConfPath = "src-tauri/tauri.conf.json"
if (Test-Path $tauriConfPath) {
    $content = Get-Content $tauriConfPath -Raw
    $content = $content -replace '"version"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+"', "`"version`": `"$newVersionNumber`""
    Set-Content -Path $tauriConfPath -Value $content
}

if (Test-Path "package.json") {
    $content = Get-Content "package.json" -Raw
    $content = $content -replace '"version"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+"', "`"version`": `"$newVersionNumber`""
    Set-Content -Path "package.json" -Value $content
}

 $cargoPath = "src-tauri/Cargo.toml"
if (Test-Path $cargoPath) {
    $content = Get-Content $cargoPath -Raw
    $content = $content -replace '^version\s*=\s*"[0-9]+\.[0-9]+\.[0-9]+"', "version = `"$newVersionNumber`""
    Set-Content -Path $cargoPath -Value $content
}

# 5. Add, Commit, Tag, and Push
 $commitMessage = "Auto-version bump to $newVersion"
git add .
git commit -m "$commitMessage" --quiet

# SAFETY: Delete tag if it already exists locally and remotely
git tag -d $newVersion 2>$null
git push origin :refs/tags/$newVersion 2>$null

git tag -a $newVersion -m "$commitMessage"

Write-Host "Pushing to remote..." -ForegroundColor DarkGray
git push --follow-tags --quiet

if (!$?) {
    Write-Host "ERROR: Git push failed! Aborting build." -ForegroundColor Red
    exit
}

Write-Host "Successfully updated to $newVersion!" -ForegroundColor Green

# 6. Tauri Build Process
 $bundlePath = "src-tauri\target\release\bundle"
if (Test-Path $bundlePath) {
    Write-Host "Cleaning old build artifacts..." -ForegroundColor DarkGray
    Remove-Item $bundlePath -Recurse -Force
}

 $env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\HP\.tauri\medstat_new.key"
 $securePassword = Read-Host "Enter your Tauri private key password (press Enter if blank)" -AsSecureString
 $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
 $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

Write-Host "Starting Tauri build..." -ForegroundColor Cyan
npm run tauri build

if (!$?) {
    Write-Host "ERROR: Build failed." -ForegroundColor Red
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    exit
}

# 7. Auto-Upload to GitHub Releases
Write-Host "Uploading artifacts to GitHub Release $newVersion..." -ForegroundColor Cyan

 $exePath = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" | Select-Object -First 1 -ExpandProperty FullName
 $sigPath = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.sig" | Select-Object -First 1 -ExpandProperty FullName
 $jsonPath = Get-ChildItem "src-tauri\target\release\bundle" -Filter "*.json" -Recurse | Where-Object { $_.Name -notlike "*build_hashes*" -and $_.Name -notlike "*.v1.json" } | Select-Object -First 1 -ExpandProperty FullName

if (!$jsonPath -and $exePath -and $sigPath) {
    Write-Host "WARN: latest.json not found. Generating it manually..." -ForegroundColor Yellow
    $signature = (Get-Content $sigPath -Raw).Trim()
    $jsonPath = "src-tauri\target\release\bundle\nsis\latest.json"
    $exeName = [System.IO.Path]::GetFileName($exePath)
    
    $jsonContent = "{`"version`": `"$newVersionNumber`", `"notes`": `"Release $newVersion`", `"pub_date`": `"$(Get-Date -Format 'o')`", `"platforms`": { `"windows-x86_64`": { `"signature`": `"$signature`", `"url`": `"https://github.com/Abdalkam/medstat/releases/download/$newVersion/$exeName`" } } }"
    $jsonContent | Out-File -FilePath $jsonPath -Encoding utf8
}

if ($exePath -and $jsonPath) {
    # Attempt to create the release
    gh release create $newVersion --title "$newVersion" --notes "Release $newVersion" $exePath $jsonPath 2>$null
    
    # FALLBACK: If it already exists, upload to the existing release instead
    if (!$?) {
        Write-Host "Release already exists. Uploading files to existing release..." -ForegroundColor Yellow
        gh release upload $newVersion $exePath $jsonPath --clobber
    }
        
    if ($?) {
        Write-Host "Release $newVersion published successfully!" -ForegroundColor Green
    } else {
        Write-Host "ERROR: GitHub release creation failed." -ForegroundColor Red
    }
} else {
    Write-Host "ERROR: Could not find the .exe or .json files." -ForegroundColor Red
}

Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue