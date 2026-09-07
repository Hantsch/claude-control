#requires -Version 5.1
<#
.SYNOPSIS
    Releases the app when there are releasable commits since the last tag. Run by CI on main.
.DESCRIPTION
    1. plan-release.ps1 derives the bump level from the commit messages since the last v* tag.
       Level "none" -> nothing is released.
    2. release.ps1 -PromoteUnreleased writes the new version into package.json and turns the
       CHANGELOG's "## Unreleased" section into the new version section. A missing or empty
       Unreleased section fails the run - that is the "no release without release notes" rule.
    3. One commit + one annotated tag v<version>.
    4. `npm run package` builds the portable EXE, and a SHA256SUMS file is written next to it.
    5. Everything is pushed and a GitHub release is created from the tag, with the notes from
       the changelog plus the download hint, and the EXE + checksum attached as assets.

    The first release has no tag to measure against, so it is not derived at all: pass
    -Version explicitly (the workflow_dispatch "version" input). Without a v* tag and without
    -Version the run stops rather than guessing a bootstrap version.
.PARAMETER ForceBump
    Ignore the commit messages and use this level (for a manual workflow_dispatch run).
.PARAMETER Version
    Release exactly this version instead of bumping. Required for the first release.
.PARAMETER DryRun
    Do everything except commit, tag, push and create the release. Files are still modified
    and the EXE is still built, so you can inspect both - revert with `git checkout -- .`.
.EXAMPLE
    pwsh -File scripts/ci-release.ps1 -DryRun
.EXAMPLE
    pwsh -File scripts/ci-release.ps1 -Version 1.0.0
#>
[CmdletBinding()]
param(
    [ValidateSet('major', 'minor', 'patch')][string]$ForceBump,
    [string]$Version,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Git {
    # Takes an explicit array on purpose: with ValueFromRemainingArguments, a git flag like
    # -a binds as a prefix of the parameter name instead of being passed through.
    param([Parameter(Mandatory = $true)][string[]]$GitArgs)
    if ($DryRun) {
        Write-Host "    [dry-run] git $($GitArgs -join ' ')" -ForegroundColor DarkGray
        return
    }
    & git -C $repoRoot @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') failed with exit code $LASTEXITCODE" }
}

Write-Host '=== plan ===' -ForegroundColor Cyan
$plan = & (Join-Path $PSScriptRoot 'plan-release.ps1')
$plan | ForEach-Object { Write-Host "  $_" }

$hasTag = @(git -C $repoRoot tag --list 'v*').Count -gt 0

if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "-Version '$Version' is not semver" }
    Write-Host "  -> explicit version $Version" -ForegroundColor Yellow
} else {
    if (-not $hasTag) {
        Write-Host ''
        Write-Host 'No v* tag exists yet, so there is no baseline to derive a version from.' -ForegroundColor Yellow
        Write-Host 'Bootstrap the first release with a workflow_dispatch run and an explicit' -ForegroundColor Yellow
        Write-Host 'version input (e.g. 1.0.0). Nothing released.' -ForegroundColor Yellow
        if ($env:GITHUB_STEP_SUMMARY) {
            Add-Content -Path $env:GITHUB_STEP_SUMMARY -Encoding UTF8 -Value @'
## Nothing released

No `v*` tag exists yet. Bootstrap the first release with a **Run workflow** dispatch and an
explicit `version` input (e.g. `1.0.0`).
'@
        }
        exit 0
    }

    $bump = $ForceBump
    if (-not $ForceBump) {
        $bumpLine = $plan | Where-Object { $_ -match '^bump=' } | Select-Object -First 1
        if (-not $bumpLine) { throw 'plan-release.ps1 returned no bump level' }
        $bump = ($bumpLine -split '=', 2)[1].Trim()
        if (@('none', 'patch', 'minor', 'major') -notcontains $bump) {
            throw "plan-release.ps1 returned an unexpected bump level '$bump'"
        }
    }

    if ($bump -eq 'none') {
        Write-Host '  -> nothing to release' -ForegroundColor DarkGray
        if ($env:GITHUB_STEP_SUMMARY) {
            Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value 'No releasable commits - nothing released.' -Encoding UTF8
        }
        exit 0
    }
}

# --- version + changelog --------------------------------------------------------------
Write-Host ''
Write-Host '=== version + notes ===' -ForegroundColor Cyan
$notesPath = Join-Path ([IO.Path]::GetTempPath()) "release-notes-$PID.md"
$releaseArgs = @{ PromoteUnreleased = $true; NotesOut = $notesPath }
if ($Version) { $releaseArgs['Version'] = $Version } else { $releaseArgs['Bump'] = $bump }

try {
    & (Join-Path $PSScriptRoot 'release.ps1') @releaseArgs
} catch {
    Write-Host ''
    Write-Host "RELEASE BLOCKED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Either add the release notes under "## Unreleased" in CHANGELOG.md, or mark the' -ForegroundColor Yellow
    Write-Host 'change as chore:/docs: (or add [skip release] to the commit) so it does not' -ForegroundColor Yellow
    Write-Host 'trigger a release.' -ForegroundColor Yellow
    exit 1
}

$version = (Get-Content -Path (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$tag = "v$version"

# --- build ------------------------------------------------------------------------------
# Built from the bumped working tree, so the EXE's own version metadata and the artifact
# name match the tag being created. `npm run package` runs typecheck first.
Write-Host ''
Write-Host '=== build ===' -ForegroundColor Cyan
& npm run package
if ($LASTEXITCODE -ne 0) { throw "npm run package failed with exit code $LASTEXITCODE" }

$exeName = "ClaudeControl-$version-portable.exe"
$exePath = Join-Path $repoRoot "release/$exeName"
if (-not (Test-Path $exePath)) { throw "expected artifact not found: $exePath" }

$hash = (Get-FileHash -Path $exePath -Algorithm SHA256).Hash.ToLower()
$sumsPath = Join-Path $repoRoot 'release/SHA256SUMS.txt'
[IO.File]::WriteAllText($sumsPath, "$hash *$exeName`n", (New-Object System.Text.UTF8Encoding($false)))
$sizeMb = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
Write-Host "  $exeName ($sizeMb MB)" -ForegroundColor Green
Write-Host "  sha256 $hash" -ForegroundColor Green

# --- release notes tail -----------------------------------------------------------------
# Two leading blank lines: without one before "---", Markdown reads it as a heading
# underline for the last note instead of a horizontal rule.
$hint = @"


---

### Download

**[$exeName](https://github.com/Hantsch/claude-control/releases/download/$tag/$exeName)** $([char]0x2014) portable, no installer. Put it anywhere and start it; it lives in the tray.

The EXE is not code-signed, so Windows SmartScreen shows *"Windows protected your PC"* on
first run $([char]0x2014) choose **More info** then **Run anyway**.

Verify the download against ``SHA256SUMS.txt``:

``````powershell
(Get-FileHash .\$exeName -Algorithm SHA256).Hash
``````

``$hash``
"@
Add-Content -Path $notesPath -Value $hint -Encoding UTF8

# --- commit, tag, push, release ----------------------------------------------------------
Write-Host ''
Write-Host '=== publish ===' -ForegroundColor Cyan
Invoke-Git @('add', 'package.json', 'package-lock.json', 'CHANGELOG.md')
Invoke-Git @('commit', '-m', "chore(release): $version [skip ci]")
Invoke-Git @('tag', '-a', $tag, '-m', "claude-control $version")
Invoke-Git @('push', '--follow-tags')

if ($DryRun) {
    Write-Host "[dry-run] gh release create $tag --title `"Claude Control $version`" --notes-file $notesPath $exePath $sumsPath" -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '--- release notes ---' -ForegroundColor DarkGray
    Get-Content -Path $notesPath | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
    exit 0
}

& gh release create $tag --title "Claude Control $version" --notes-file $notesPath $exePath $sumsPath
if ($LASTEXITCODE -ne 0) { throw "gh release create failed for $tag" }
Write-Host "created GitHub release $tag" -ForegroundColor Green

if ($env:GITHUB_STEP_SUMMARY) {
    $lines = @(
        '## Released',
        '',
        "- **Claude Control $version** - tag ``$tag``",
        "- ``$exeName`` ($sizeMb MB)",
        "- sha256 ``$hash``"
    )
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ($lines -join "`n") -Encoding UTF8
}
