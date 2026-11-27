[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Prepare', 'Sign')][string]$Phase)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

if (-not $IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:GITHUB_REPOSITORY -cne 'ABDO-TECK/pos-desktop-updates') {
    throw 'Use the GitHub-hosted Windows beta release workflow.'
}

$tag = 'v0.0.15-beta.1'
$baseline = '0.0.14'
$target = $tag.Substring(1)
$baselineCommit = 'cee698f8b5d2cb8577a485f9a07330184986e9a5'
$mergeCommit = 'e98ed9f5a25305af8c147e73a9a9737d983f3839'
$sourceRoot = (Get-Location).Path
$setup = Join-Path $env:RUNNER_TEMP 'setup14-shell'
$shell = Join-Path $setup 'source'
$setupApp = Join-Path $shell 'resources/app.asar.unpacked'
$setupInventory = Join-Path $setup 'deployment-inventory.json'
$labName = 'shell-release-a44773e9675841a3be53781c0c4d2ffa'
$lab = Join-Path $env:RUNNER_TEMP $labName
$assets = Join-Path $sourceRoot 'release-assets'

if ((git rev-parse HEAD) -cne $env:SOURCE_SHA) {
    throw 'The checked-out source does not match the reviewed beta source SHA.'
}
git merge-base --is-ancestor $mergeCommit HEAD
if (@(git diff --name-only $mergeCommit HEAD -- backend frontend electron build database package.json package-lock.json).Count) {
    throw 'The beta release source must keep the merged product files.'
}
if (@(git diff --name-only $baselineCommit HEAD -- electron build package.json package-lock.json scripts/desktop-runtime.json database).Count) {
    throw 'The beta must retain the Setup 0.0.14 shell and database migrations.'
}

$version = Get-Content -LiteralPath 'version.json' -Raw | ConvertFrom-Json
if ($version.version -cne $target -or $version.application_version -cne $target -or
    $version.installer_version -cne $baseline -or $version.channel -cne 'beta' -or
    $version.update_channel -cne 'beta' -or $version.release_type -cne 'delta' -or
    @($version.delta_baseline_tags).Count -ne 1 -or $version.delta_baseline_tags[0] -cne "v$baseline") {
    throw 'Unexpected beta release metadata.'
}

if ($Phase -ceq 'Prepare') {
    node scripts/release-metadata.mjs $tag
    ./scripts/verify-setup13-shell-baseline.ps1 -BinaryAcceptance
    $sourceProfile = Join-Path $lab 'source/installed-payload/resources'
    $targetProfile = Join-Path $lab 'target/win-unpacked/resources'
    New-Item -ItemType Directory -Path (Join-Path $lab 'evidence') | Out-Null
    foreach ($profile in @($sourceProfile, $targetProfile)) {
        New-Item -ItemType Directory -Path (Join-Path $profile 'portable'),
            (Join-Path $profile 'app.asar.unpacked/backend'), (Join-Path $profile 'app.asar.unpacked/database') | Out-Null
        Copy-Item -LiteralPath (Join-Path $shell 'resources/portable/mysql') -Destination (Join-Path $profile 'portable/mysql') -Recurse
    }
    foreach ($relative in @('backend/backend.phar', 'database/pos_schema.sql')) {
        Copy-Item -LiteralPath (Join-Path $setupApp $relative) -Destination (Join-Path $sourceProfile "app.asar.unpacked/$relative")
        Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination (Join-Path $targetProfile "app.asar.unpacked/$relative")
    }
    ./scripts/verify-setup13-shell-data.ps1 -Profile release -ReleaseLab $labName
    $sourceContract = (Get-FileHash -LiteralPath (Join-Path $lab 'source-contract.json')).Hash
    $targetContract = (Get-FileHash -LiteralPath (Join-Path $lab 'target-contract.json')).Hash
    if ($sourceContract -cne $targetContract) {
        throw 'Setup 0.0.14 and the beta emit different MariaDB compatibility contracts.'
    }
    exit
}

if (-not $env:UPDATE_PRIVATE_KEY) { throw 'The production signing key is required.' }
git tag $tag HEAD
node scripts/validate-release-source.mjs --mode delta --tag $tag --release-channel beta --baseline-ref $baselineCommit --baseline-version $baseline
php scripts/build-release-package.php "--tag=$tag" "--from-ref=$baselineCommit" "--from-version=$baseline" "--baseline-inventory=$setupInventory" "--output-dir=$assets"
php scripts/verify-release-package.php "--release-dir=$assets" "--target-version=$target" "--minimum-version=$baseline"
node scripts/validate-release-source.mjs --mode delta --tag $tag --release-channel beta --baseline-ref $baselineCommit --baseline-version $baseline --manifest (Join-Path $assets 'manifest.json')

Copy-Item -LiteralPath (Join-Path $assets 'manifest.json') -Destination (Join-Path $assets "manifest-$baseline.json")
Copy-Item -LiteralPath (Join-Path $assets 'manifest.sig') -Destination (Join-Path $assets "manifest-$baseline.sig")
Copy-Item -LiteralPath (Join-Path $assets "delta-$baseline-to-$target.zip") -Destination (Join-Path $assets 'delta.zip')

$betaInventory = Join-Path $assets 'deployment-inventory.json'
$contract = Join-Path $lab 'source-contract.json'
$common = @("--contract=$contract", "--carrier-tag=$tag", "--output=$assets", "--shell-root=$shell")
php scripts/build-channel-transition.php @common "--source-root=$setupApp" "--source-inventory=$setupInventory" "--target-root=$sourceRoot" "--target-inventory=$betaInventory" '--target-repo=pos-desktop-updates' "--target-tag=$tag"
php scripts/build-channel-transition.php @common "--source-root=$sourceRoot" "--source-inventory=$betaInventory" "--target-root=$setupApp" "--target-inventory=$setupInventory" '--target-repo=pos-desktop' "--target-tag=v$baseline" --append

@"
# POS Desktop $target

Beta application update for Windows x64 installations of Setup 0.0.14.

- Adds the signed binary transport for future compatible native shell updates, with the signed ZIP fallback.
- Shows a confirmed up-to-date status in the Arabic Update Center when there is no eligible release.

To try the beta, open the Admin Update Center, select Beta and apply the signed channel transition. To return, select Stable and apply the offered 0.0.14 transition. The transition retains your installed native shell and uses the existing compatibility checks to protect your data.

Installations with an older native shell, including the historical 0.0.12-beta.1, need to run [Setup 0.0.14](https://github.com/ABDO-TECK/pos-desktop/releases/tag/v0.0.14) over the current installation before opting into this beta. Close POS Desktop first and use the in-place upgrade. Uninstalling removes local data.

Source commit: $env:SOURCE_SHA
"@ | Set-Content -LiteralPath (Join-Path $assets 'release-notes.md') -Encoding utf8NoBOM

[ordered]@{
    format = 1
    tag = $tag
    source_repository = 'ABDO-TECK/pos-desktop'
    source_sha = $env:SOURCE_SHA
    merged_pr_sha = $mergeCommit
    setup_tag = "v$baseline"
    setup_source_sha = $baselineCommit
    setup_inventory_sha256 = (Get-FileHash -LiteralPath $setupInventory).Hash.ToLowerInvariant()
    updates_workflow_sha = $env:GITHUB_SHA
    stage_run_id = $env:GITHUB_RUN_ID
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $assets 'source-provenance.json') -Encoding utf8NoBOM
