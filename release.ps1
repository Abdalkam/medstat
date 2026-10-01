$ErrorActionPreference = "Stop"

# ============================================================
# SmartPages Automatic Release Script
# ============================================================

$ProjectRoot = (Get-Location).Path

$TauriConfig = Join-Path $ProjectRoot "src-tauri\tauri.conf.json"
$PackageJson = Join-Path $ProjectRoot "package.json"
$CargoToml   = Join-Path $ProjectRoot "src-tauri\Cargo.toml"

# Existing Tauri signing key
$SigningKeyFile = Join-Path $env:USERPROFILE ".tauri\medstat_prime.key"

# Updater repository
$UpdaterRepo   = "Abdalkam/medstat-updates"
$UpdaterBranch = "main"

function Write-Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Set-FileText($Path, $Content) {
    [System.IO.File]::WriteAllText(
        $Path,
        $Content,
        [System.Text.UTF8Encoding]::new($false)
    )
}

# ============================================================
# CHECK PROJECT FILES
# ============================================================

Write-Step "Checking project files"

if (!(Test-Path $TauriConfig)) {
    throw "Missing file: $TauriConfig"
}

if (!(Test-Path $PackageJson)) {
    throw "Missing file: $PackageJson"
}

if (!(Test-Path $CargoToml)) {
    throw "Missing file: $CargoToml"
}

Write-Host "Project files found." -ForegroundColor Green

# ============================================================
# LOAD TAURI SIGNING KEY
# ============================================================

Write-Step "Loading Tauri updater signing key"

if (!(Test-Path $SigningKeyFile)) {
    throw "Signing key not found: $SigningKeyFile"
}

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $SigningKeyFile -Raw

if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
    throw "Signing key file is empty."
}

Write-Host "Signing key loaded successfully." -ForegroundColor Green

# ============================================================
# READ CURRENT VERSION
# ============================================================

Write-Step "Reading current version"

$TauriJson = Get-Content $TauriConfig -Raw | ConvertFrom-Json
$Package   = Get-Content $PackageJson -Raw | ConvertFrom-Json

$CurrentVersion = [string]$TauriJson.version

if ([string]::IsNullOrWhiteSpace($CurrentVersion)) {
    throw "Could not determine current version."
}

Write-Host "Current version: $CurrentVersion"

# ============================================================
# CALCULATE NEXT PATCH VERSION
# ============================================================

$VersionParts = $CurrentVersion.Split(".")

if ($VersionParts.Count -ne 3) {
    throw "Version '$CurrentVersion' is not in x.y.z format."
}

$Major = [int]$VersionParts[0]
$Minor = [int]$VersionParts[1]
$Patch = [int]$VersionParts[2]

$Version = "$Major.$Minor.$($Patch + 1)"

Write-Step "Bumping version $CurrentVersion -> $Version"

# ============================================================
# SAVE ORIGINAL FILES
# ============================================================

$OriginalTauri   = Get-Content $TauriConfig -Raw
$OriginalPackage = Get-Content $PackageJson -Raw
$OriginalCargo   = Get-Content $CargoToml -Raw

$LatestJsonPath = $null
$UpdaterWorkDir = $null

try {

    # ========================================================
    # UPDATE TAURI CONFIG
    # ========================================================

    Write-Step "Updating tauri.conf.json"

    $TauriJson.version = $Version

    $NewTauriText = $TauriJson | ConvertTo-Json -Depth 100

    Set-FileText $TauriConfig $NewTauriText

    # ========================================================
    # UPDATE PACKAGE.JSON
    # ========================================================

    Write-Step "Updating package.json"

    $Package.version = $Version

    $NewPackageText = $Package | ConvertTo-Json -Depth 100

    Set-FileText $PackageJson $NewPackageText

    # ========================================================
    # UPDATE CARGO.TOML
    # ========================================================

    Write-Step "Updating Cargo.toml"

    $CargoText = Get-Content $CargoToml -Raw

    $CargoText = $CargoText -replace `
        '(?m)^version\s*=\s*"[^"]+"', `
        "version = `"$Version`""

    Set-FileText $CargoToml $CargoText

    # ========================================================
    # VERIFY VERSION SYNCHRONIZATION
    # ========================================================

    Write-Step "Verifying version synchronization"

    $VerifyTauri = (
        Get-Content $TauriConfig -Raw |
        ConvertFrom-Json
    ).version

    $VerifyPackage = (
        Get-Content $PackageJson -Raw |
        ConvertFrom-Json
    ).version

    $VerifyCargoMatch = Select-String `
        -Path $CargoToml `
        -Pattern '^version\s*=\s*"([^"]+)"'

    if (!$VerifyCargoMatch) {
        throw "Could not read Cargo.toml version."
    }

    $VerifyCargo = $VerifyCargoMatch.Matches[0].Groups[1].Value

    Write-Host ""
    Write-Host "Version check:"
    Write-Host "  tauri.conf.json : $VerifyTauri"
    Write-Host "  package.json    : $VerifyPackage"
    Write-Host "  Cargo.toml      : $VerifyCargo"

    if (
        $VerifyTauri -ne $Version -or
        $VerifyPackage -ne $Version -or
        $VerifyCargo -ne $Version
    ) {
        throw "Version synchronization failed."
    }

    Write-Host ""
    Write-Host "All versions synchronized to v$Version." -ForegroundColor Green

    # ========================================================
    # CHECK GITHUB CLI
    # ========================================================

    Write-Step "Checking GitHub CLI"

    if (!(Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI 'gh' is not installed or not in PATH."
    }

    gh auth status

    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI is not authenticated."
    }

    Write-Host "GitHub CLI authentication OK." -ForegroundColor Green

    # ========================================================
    # DETECT MAIN GITHUB REPOSITORY
    # ========================================================

    Write-Step "Detecting GitHub repository"

    $RemoteUrl = git remote get-url origin

    if ($LASTEXITCODE -ne 0) {
        throw "Could not determine Git remote."
    }

    if ($RemoteUrl -match "github\.com[:/]([^/]+/[^/.]+)(\.git)?$") {
        $Repo = $Matches[1]
    }
    else {
        throw "Could not determine GitHub repository from: $RemoteUrl"
    }

    Write-Host "Repository: $Repo"

    # ========================================================
    # BUILD AND SIGN
    # ========================================================

    Write-Step "Building and signing SmartPages v$Version"

    npm run tauri build

    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed."
    }

    Write-Host "Build and signing completed successfully." -ForegroundColor Green

    # ========================================================
    # LOCATE INSTALLER
    # ========================================================

    Write-Step "Locating installer"

    $NsisDir = Join-Path `
        $ProjectRoot `
        "src-tauri\target\release\bundle\nsis"

    if (!(Test-Path $NsisDir)) {
        throw "NSIS output directory not found: $NsisDir"
    }

    $ExpectedExeName = "SmartPages_${Version}_x64-setup.exe"

    $ExePath = Join-Path $NsisDir $ExpectedExeName

    if (!(Test-Path $ExePath)) {
        throw "Expected installer not found: $ExePath"
    }

    $Exe = Get-Item $ExePath

    $SigPath = "$($Exe.FullName).sig"

    if (!(Test-Path $SigPath)) {
        throw "Signature file not found: $SigPath"
    }

    Write-Host ""
    Write-Host "Installer:"
    Write-Host "  $($Exe.FullName)"

    Write-Host ""
    Write-Host "Signature:"
    Write-Host "  $SigPath"

    # ========================================================
    # GITHUB RELEASE
    # ========================================================

    $Tag = "v$Version"

    Write-Step "Checking GitHub Release $Tag"

    $releaseExists = $false

    # gh returns non-zero when the release does not exist.
    # Temporarily prevent that expected result from stopping PowerShell.
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    gh release view $Tag --repo $Repo *> $null

    $ReleaseCheckExitCode = $LASTEXITCODE

    $ErrorActionPreference = $PreviousErrorActionPreference

    if ($ReleaseCheckExitCode -eq 0) {
        $releaseExists = $true
    }

    if ($releaseExists) {

        Write-Host "Release $Tag already exists." -ForegroundColor Yellow

    }
    else {

        Write-Host "Release $Tag does not exist. Creating it."

        gh release create $Tag `
            --repo $Repo `
            --title "SmartPages $Tag" `
            --notes "SmartPages release $Tag"

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create GitHub Release $Tag."
        }

        Write-Host ""
        Write-Host "GitHub Release $Tag created successfully." -ForegroundColor Green
    }

    # ========================================================
    # UPLOAD INSTALLER AND SIGNATURE
    # ========================================================

    Write-Step "Uploading installer and signature"

    gh release upload $Tag `
        $Exe.FullName `
        $SigPath `
        --repo $Repo `
        --clobber

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upload installer/signature."
    }

    Write-Host "Installer and signature uploaded." -ForegroundColor Green

    # ========================================================
    # GENERATE LATEST.JSON
    # ========================================================

    Write-Step "Generating latest.json"

    $Signature = (Get-Content $SigPath -Raw).Trim()

    if ([string]::IsNullOrWhiteSpace($Signature)) {
        throw "Signature file is empty."
    }

    $ReleaseUrl = `
        "https://github.com/$Repo/releases/download/$Tag/$($Exe.Name)"

    $LatestJsonObject = [ordered]@{
        version = $Version
        notes = "SmartPages release v$Version"
        pub_date = (
            Get-Date
        ).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

        platforms = [ordered]@{
            "windows-x86_64" = [ordered]@{
                signature = $Signature
                url = $ReleaseUrl
            }
        }
    }

    $LatestJson = `
        $LatestJsonObject |
        ConvertTo-Json -Depth 10

    $LatestJsonPath = Join-Path `
        $env:TEMP `
        "SmartPages-latest-$Version.json"

    Set-FileText $LatestJsonPath $LatestJson

    Write-Host ""
    Write-Host "latest.json:"
    Write-Host ""
    Write-Host $LatestJson

    # ========================================================
    # UPLOAD LATEST.JSON TO RELEASE
    # ========================================================

    Write-Step "Uploading latest.json to GitHub Release"

    gh release upload $Tag `
        $LatestJsonPath `
        --repo $Repo `
        --clobber

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upload latest.json to GitHub Release."
    }

    Write-Host "latest.json uploaded to release." -ForegroundColor Green

    # ========================================================
    # UPDATE UPDATER REPOSITORY
    # ========================================================

    Write-Step "Updating updater repository $UpdaterRepo"

    $UpdaterWorkDir = Join-Path `
        $env:TEMP `
        "smartpages-updater-$Version"

    if (Test-Path $UpdaterWorkDir) {
        Remove-Item `
            $UpdaterWorkDir `
            -Recurse `
            -Force
    }

    git clone `
        --branch $UpdaterBranch `
        "https://github.com/$UpdaterRepo.git" `
        $UpdaterWorkDir

    if ($LASTEXITCODE -ne 0) {
        throw "Could not clone updater repository $UpdaterRepo."
    }

    Write-Host "Updater repository cloned."

    $UpdaterLatestJson = Join-Path `
        $UpdaterWorkDir `
        "latest.json"

    Copy-Item `
        $LatestJsonPath `
        $UpdaterLatestJson `
        -Force

    Push-Location $UpdaterWorkDir

    try {

        git config user.name "SmartPages Release Bot"

        git config `
            user.email `
            "smartpages@medstatinitiative.org"

        git add latest.json

        # Check whether there is anything to commit.
        $PreviousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        git diff --cached --quiet

        $DiffExitCode = $LASTEXITCODE

        $ErrorActionPreference = $PreviousErrorActionPreference

        if ($DiffExitCode -eq 0) {

            Write-Host `
                "latest.json is already up to date." `
                -ForegroundColor Yellow

        }
        else {

            Write-Host "Committing updater latest.json..."

            git commit `
                -m "Update SmartPages updater to v$Version"

            if ($LASTEXITCODE -ne 0) {
                throw "Failed to commit latest.json."
            }

            Write-Host "Pushing updater repository..."

            git push origin $UpdaterBranch

            if ($LASTEXITCODE -ne 0) {
                throw "Failed to push latest.json to updater repository."
            }

            Write-Host ""
            Write-Host `
                "Updater repository updated successfully." `
                -ForegroundColor Green
        }

    }
    finally {

        Pop-Location
    }

    # ========================================================
    # COMMIT MAIN PROJECT VERSION CHANGES
    # ========================================================

    Write-Step "Committing main project version changes"

    git add `
        src-tauri/tauri.conf.json `
        package.json `
        src-tauri/Cargo.toml

    # Check whether there are changes.
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    git diff --cached --quiet

    $MainDiffExitCode = $LASTEXITCODE

    $ErrorActionPreference = $PreviousErrorActionPreference

    if ($MainDiffExitCode -eq 0) {

        Write-Host "No version changes to commit."

    }
    else {

        git commit `
            -m "Release SmartPages v$Version"

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to commit main project version changes."
        }

        git push origin HEAD

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to push main project."
        }

        Write-Host `
            "Main project version changes pushed successfully." `
            -ForegroundColor Green
    }

    # ========================================================
    # CLEANUP
    # ========================================================

    Write-Step "Cleaning temporary files"

    if ($UpdaterWorkDir -and (Test-Path $UpdaterWorkDir)) {
        Remove-Item `
            $UpdaterWorkDir `
            -Recurse `
            -Force
    }

    if ($LatestJsonPath -and (Test-Path $LatestJsonPath)) {
        Remove-Item `
            $LatestJsonPath `
            -Force
    }

    # ========================================================
    # SUCCESS
    # ========================================================

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "SMARTPAGES RELEASE SUCCESSFUL" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Version:"
    Write-Host "  v$Version"
    Write-Host ""
    Write-Host "Installer:"
    Write-Host "  $($Exe.Name)"
    Write-Host ""
    Write-Host "GitHub Release:"
    Write-Host "  https://github.com/$Repo/releases/tag/$Tag"
    Write-Host ""
    Write-Host "Updater JSON:"
    Write-Host "  https://raw.githubusercontent.com/$UpdaterRepo/$UpdaterBranch/latest.json"
    Write-Host ""
    Write-Host "SmartPages updater has been updated to v$Version."
    Write-Host ""

}
catch {

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host "RELEASE FAILED" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host $_.Exception.Message -ForegroundColor Red

    # ========================================================
    # RESTORE VERSION FILES
    # ========================================================

    Write-Host ""
    Write-Host "Restoring previous version $CurrentVersion..." -ForegroundColor Yellow

    Set-FileText `
        $TauriConfig `
        $OriginalTauri

    Set-FileText `
        $PackageJson `
        $OriginalPackage

    Set-FileText `
        $CargoToml `
        $OriginalCargo

    Write-Host ""
    Write-Host `
        "Version files restored to $CurrentVersion." `
        -ForegroundColor Yellow

    # Cleanup temporary files if they exist
    if ($UpdaterWorkDir -and (Test-Path $UpdaterWorkDir)) {
        Remove-Item `
            $UpdaterWorkDir `
            -Recurse `
            -Force `
            -ErrorAction SilentlyContinue
    }

    if ($LatestJsonPath -and (Test-Path $LatestJsonPath)) {
        Remove-Item `
            $LatestJsonPath `
            -Force `
            -ErrorAction SilentlyContinue
    }

    exit 1
}