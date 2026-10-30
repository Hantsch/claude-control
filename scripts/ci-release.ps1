#requires -Version 5.1
<#
.SYNOPSIS
    Releases the app when there are releasable commits since the last tag. Run by CI on main.
.DESCRIPTION
    1. plan-release.ps1 derives the bump level from the commit messages since the last v* tag.
       Level "none" -> nothing is released (and no tests run).
    2. tests: `npm test` runs once a release is due, before anything is written or committed.
       A failing suite stops the run.
    3. release.ps1 -PromoteUnreleased writes the new version into package.json and turns the
       CHANGELOG's "## Unreleased" section into the new version section. A missing or empty
       Unreleased section fails the run - that is the "no release without release notes" rule.
    4. One commit + one annotated tag v<version>.
    5. `npm run package` builds the portable EXE, and a SHA256SUMS file is written next to it.
    6. Everything is pushed and a GitHub release is created from the tag, with the notes from
       the changelog plus the download hint, and the EXE + checksum attached as assets.

    A v* tag on HEAD itself means an earlier run got as far as the tag. If GitHub already has its
    release, nothing happens. If not, the run recovers it: no plan, tests, bump or git writes -
    only build, checksum and the GitHub release, with the notes from that version's CHANGELOG
    section.

    The first release has no tag to measure against, so nothing can be derived - and deriving
    from the whole history would land on 0.1.1 rather than the version the project calls its
    first. That case reads package.json instead and releases its version verbatim, without
    bumping it. So the first merge to main releases too; no manual dispatch is needed.
.PARAMETER ForceBump
    Ignore the commit messages and use this level (for a manual workflow_dispatch run).
.PARAMETER Version
    Release exactly this version instead of bumping.
.PARAMETER DryRun
    Do everything except commit, tag, push and create the release. The tests still run, files
    are still modified and the EXE is still built, so you can inspect both - revert with `git checkout -- .`.
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

function Test-GitHubRelease {
    param([Parameter(Mandatory = $true)][string]$Tag)
    # A missing gh must fail the run: otherwise $LASTEXITCODE still holds the last git call's 0
    # and the tag would count as released.
    $null = Get-Command gh -CommandType Application -ErrorAction Stop
    # gh reports "release not found" on stderr; under 'Stop', Windows PowerShell turns
    # redirected native stderr into a terminating error, so only the exit code may decide here.
    $ErrorActionPreference = 'Continue'
    & gh release view $Tag *> $null
    return ($LASTEXITCODE -eq 0)
}

function Get-Artifact {
    param([Parameter(Mandatory = $true)][string]$Version)
    $exeName = "ClaudeControl-$Version-portable.exe"
    [pscustomobject]@{
        Version  = $Version
        Tag      = "v$Version"
        ExeName  = $exeName
        ExePath  = Join-Path $repoRoot "release/$exeName"
        SumsPath = Join-Path $repoRoot 'release/SHA256SUMS.txt'
        Hash     = $null
        SizeMb   = $null
    }
}

function Build-Artifact {
    # Built from the working tree's version, so the EXE's own version metadata and the
    # artifact name match the tag. `npm run package` runs typecheck first.
    param([Parameter(Mandatory = $true)]$Artifact)
    Write-Host ''
    Write-Host '=== build ===' -ForegroundColor Cyan
    & npm run package
    if ($LASTEXITCODE -ne 0) { throw "npm run package failed with exit code $LASTEXITCODE" }
    if (-not (Test-Path $Artifact.ExePath)) { throw "expected artifact not found: $($Artifact.ExePath)" }
}

function Write-Sums {
    param([Parameter(Mandatory = $true)]$Artifact)
    $exeName = $Artifact.ExeName
    $exePath = $Artifact.ExePath
    $sumsPath = $Artifact.SumsPath

    $hash = (Get-FileHash -Path $exePath -Algorithm SHA256).Hash.ToLower()
    [IO.File]::WriteAllText($sumsPath, "$hash *$exeName`n", (New-Object System.Text.UTF8Encoding($false)))

    # Self-check: the update-checker trusts this exact producing format - "<sha256> *<filename>"
    # per line - so a corrupted write here must fail the release loudly instead of shipping a
    # checksums file consumers can't parse.
    $sumsLines = Get-Content -Path $sumsPath -Encoding UTF8
    foreach ($line in $sumsLines) {
        if ($line -notmatch '^[0-9a-f]{64} \*.+$') {
            throw "SHA256SUMS.txt self-check failed: line '$line' does not match '<sha256> *<filename>'"
        }
    }
    $expectedLine = "$hash *$exeName"
    if ($sumsLines -notcontains $expectedLine) {
        throw "SHA256SUMS.txt self-check failed: expected line '$expectedLine' not found in $sumsPath"
    }

    $sizeMb = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
    Write-Host "  $exeName ($sizeMb MB)" -ForegroundColor Green
    Write-Host "  sha256 $hash" -ForegroundColor Green
    $Artifact.Hash = $hash
    $Artifact.SizeMb = $sizeMb
}

function Add-DownloadHint {
    param([Parameter(Mandatory = $true)]$Artifact, [Parameter(Mandatory = $true)][string]$NotesPath)
    $exeName = $Artifact.ExeName
    $tag = $Artifact.Tag
    $hash = $Artifact.Hash
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
    Add-Content -Path $NotesPath -Value $hint -Encoding UTF8
}

function Publish-Release {
    # Ends the run: in a dry run after printing what would be created, otherwise after the
    # GitHub release exists.
    param([Parameter(Mandatory = $true)]$Artifact, [Parameter(Mandatory = $true)][string]$NotesPath)
    $version = $Artifact.Version
    $tag = $Artifact.Tag
    $exeName = $Artifact.ExeName
    $exePath = $Artifact.ExePath
    $sumsPath = $Artifact.SumsPath

    if ($DryRun) {
        Write-Host "[dry-run] gh release create $tag --title `"Claude Control $version`" --notes-file $NotesPath $exePath $sumsPath" -ForegroundColor DarkGray
        Write-Host ''
        Write-Host '--- release notes ---' -ForegroundColor DarkGray
        Get-Content -Path $NotesPath | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
        exit 0
    }

    & gh release create $tag --title "Claude Control $version" --notes-file $NotesPath $exePath $sumsPath
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed for $tag" }
    Write-Host "created GitHub release $tag" -ForegroundColor Green

    if ($env:GITHUB_STEP_SUMMARY) {
        $lines = @(
            '## Released',
            '',
            "- **Claude Control $version** - tag ``$tag``",
            "- ``$exeName`` ($($Artifact.SizeMb) MB)",
            "- sha256 ``$($Artifact.Hash)``"
        )
        Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ($lines -join "`n") -Encoding UTF8
    }
    exit 0
}

$notesPath = Join-Path ([IO.Path]::GetTempPath()) "release-notes-$PID.md"

# --- tag at HEAD: released already, or a run that stopped after pushing the tag -------------
# Only a tag on HEAD itself counts (never `git describe`): an older reachable tag says nothing
# about whether this commit was released. Checked before -Version/-ForceBump, because bumping
# past a pushed tag whose release is missing would skip that version's release for good.
$headTags = @(& git -C $repoRoot tag --points-at HEAD --list 'v*' --sort=-v:refname)
if ($LASTEXITCODE -ne 0) { throw "git tag --points-at HEAD failed with exit code $LASTEXITCODE" }
$headTag = $headTags | Select-Object -First 1
if ($headTag) {
    if (Test-GitHubRelease -Tag $headTag) {
        Write-Host "-> nothing to release: $headTag is already released" -ForegroundColor DarkGray
        if ($env:GITHUB_STEP_SUMMARY) {
            Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value 'No releasable commits - nothing released.' -Encoding UTF8
        }
        exit 0
    }

    # The commit and tag are pushed already, so only the release itself is missing: no plan,
    # no tests, no version bump and no git writes - build, sum and publish what the tag holds.
    Write-Host '=== recover ===' -ForegroundColor Cyan
    Write-Host "-> $headTag has no GitHub release - recovering it" -ForegroundColor Yellow
    $version = (Get-Content -Path (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ("v$version" -ne $headTag) {
        throw "package.json version '$version' does not match the tag $headTag at HEAD - cannot recover its release"
    }

    $changelogLines = @(Get-Content -Path (Join-Path $repoRoot 'CHANGELOG.md') -Encoding UTF8)
    $headingPattern = '^##\s+\[?' + [regex]::Escape($version) + '\]?(\s|$)'
    $start = -1
    for ($i = 0; $i -lt $changelogLines.Count; $i++) {
        if ($changelogLines[$i] -match $headingPattern) { $start = $i; break }
    }
    if ($start -lt 0) { throw "CHANGELOG.md has no '## $version' section - no release notes to recover $headTag with" }
    $end = $changelogLines.Count
    for ($i = $start + 1; $i -lt $changelogLines.Count; $i++) {
        if ($changelogLines[$i] -match '^## ') { $end = $i; break }
    }
    # Guarded: an empty section would make the range below count downwards.
    $body = ''
    if ($end -gt $start + 1) { $body = ($changelogLines[($start + 1)..($end - 1)] -join "`r`n").Trim() }
    if (-not $body) { throw "the '## $version' section of CHANGELOG.md is empty - no release notes to recover $headTag with" }
    Write-Host "  notes from CHANGELOG: $($changelogLines[$start])"
    [IO.File]::WriteAllText($notesPath, $body, (New-Object System.Text.UTF8Encoding($false)))

    $artifact = Get-Artifact -Version $version
    Build-Artifact -Artifact $artifact
    Write-Sums -Artifact $artifact
    Add-DownloadHint -Artifact $artifact -NotesPath $notesPath
    Write-Host ''
    Write-Host '=== publish ===' -ForegroundColor Cyan
    Publish-Release -Artifact $artifact -NotesPath $notesPath
}

Write-Host '=== plan ===' -ForegroundColor Cyan
$plan = & (Join-Path $PSScriptRoot 'plan-release.ps1')
$plan | ForEach-Object { Write-Host "  $_" }

$hasTag = @(git -C $repoRoot tag --list 'v*').Count -gt 0

$bootstrap = $false

if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "-Version '$Version' is not semver" }
    Write-Host "  -> explicit version $Version" -ForegroundColor Yellow
} elseif (-not $hasTag) {
    # First release. There is no tag to measure against, so a bump cannot be derived - and
    # deriving one from the whole history is wrong anyway (it lands on 0.1.1, not on the
    # version the project considers its first). package.json is the answer instead: release
    # exactly what it says, verbatim, without bumping it. Every later run has a tag and takes
    # the derived path below.
    $Version = (Get-Content -Path (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "package.json version '$Version' is not semver" }
    $bootstrap = $true
    Write-Host "  -> first release: no v* tag yet, releasing package.json's $Version verbatim" -ForegroundColor Yellow
} else {
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

# --- test -------------------------------------------------------------------------------
Write-Host ''
Write-Host '=== test ===' -ForegroundColor Cyan
Push-Location $repoRoot
try {
    # Tests the merge result on main, which nothing else does: a direct push has no PR and
    # validate.yml only tests the PR head. Only a due release gets here, so docs-only merges run none.
    & npm test
    if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

# --- version + changelog --------------------------------------------------------------
Write-Host ''
Write-Host '=== version + notes ===' -ForegroundColor Cyan
$releaseArgs = @{ PromoteUnreleased = $true; NotesOut = $notesPath }
if ($Version) { $releaseArgs['Version'] = $Version } else { $releaseArgs['Bump'] = $bump }
# The bootstrap release is package.json's own version, so release.ps1 would otherwise refuse
# it as "already that version - nothing to do". Everything else it does still applies.
if ($bootstrap) { $releaseArgs['AllowUnchangedVersion'] = $true }

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

$artifact = Get-Artifact -Version $version
Build-Artifact -Artifact $artifact
Write-Sums -Artifact $artifact
Add-DownloadHint -Artifact $artifact -NotesPath $notesPath

# --- commit, tag, push, release ----------------------------------------------------------
# `push --follow-tags` must stay repeatable: pushing an already pushed commit and tag again is
# a no-op that exits 0, so nothing here may add a step that fails on "Everything up-to-date".
Write-Host ''
Write-Host '=== publish ===' -ForegroundColor Cyan
Invoke-Git @('add', 'package.json', 'package-lock.json', 'CHANGELOG.md')
Invoke-Git @('commit', '-m', "chore(release): $version [skip ci]")
Invoke-Git @('tag', '-a', $tag, '-m', "claude-control $version")
Invoke-Git @('push', '--follow-tags')

Publish-Release -Artifact $artifact -NotesPath $notesPath
