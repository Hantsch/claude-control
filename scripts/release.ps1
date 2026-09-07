#requires -Version 5.1
<#
.SYNOPSIS
    Bumps the app version in package.json and opens a CHANGELOG section.
.DESCRIPTION
    Never commits and never pushes - it edits files and (with -Tag) creates a local git tag.
    Review the diff, then commit yourself.
.PARAMETER Bump
    major | minor | patch. Ignored when -Version is given.
.PARAMETER Version
    Explicit version instead of a bump, e.g. 1.0.0.
.PARAMETER Tag
    Also create the local git tag v<version>.
.PARAMETER PromoteUnreleased
    Turn the CHANGELOG's "## Unreleased" section into "## <version> - <date>" instead of
    inserting an empty template section, and leave a fresh empty Unreleased behind. Fails
    when that section is empty or still holds placeholders - this is what blocks a release
    without release notes. Used by the CI release workflow.
.PARAMETER NotesOut
    Write the release notes (the promoted section's body) to this file, for use as GitHub
    release notes.
.PARAMETER ValidateNotesOnly
    Only run the -PromoteUnreleased notes validation and exit - no file is touched, no version
    is computed. This is how check-notes.ps1 reaches the release workflow's verdict without
    performing a release.
.EXAMPLE
    pwsh -File scripts/release.ps1 -Bump minor
.EXAMPLE
    pwsh -File scripts/release.ps1 -Version 1.0.0 -Tag
#>
[CmdletBinding()]
param(
    [ValidateSet('major', 'minor', 'patch')][string]$Bump = 'patch',
    [string]$Version,
    [switch]$Tag,
    [switch]$PromoteUnreleased,
    [string]$NotesOut,
    [switch]$ValidateNotesOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# -ValidateNotesOnly is the front half of a promoted release and nothing else, so it runs the
# identical code path instead of a copy that can drift away from it.
if ($ValidateNotesOnly) { $PromoteUnreleased = $true }

function Write-TextFile {
    # UTF-8 without BOM, explicitly: on PowerShell 5.1 `Set-Content -Encoding UTF8` writes a
    # BOM, and a BOM in front of package.json breaks strict JSON parsers.
    param([string]$Path, [string]$Text)
    [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

$manifestPath = Join-Path $repoRoot 'package.json'
$changelogPath = Join-Path $repoRoot 'CHANGELOG.md'
if (-not (Test-Path $manifestPath)) { throw "not found: $manifestPath" }

$manifestText = Get-Content -Path $manifestPath -Raw -Encoding UTF8
$current = ($manifestText | ConvertFrom-Json).version
if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw "current version '$current' is not semver" }

if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "-Version '$Version' is not semver" }
    $next = $Version
} else {
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]; $patch = [int]$Matches[3]
    if ($Bump -eq 'major') { $major++; $minor = 0; $patch = 0 }
    elseif ($Bump -eq 'minor') { $minor++; $patch = 0 }
    else { $patch++ }
    $next = "$major.$minor.$patch"
}

if ($next -eq $current) { throw "version is already $next - nothing to do" }

# Em dash as a char code on purpose: this file must stay pure ASCII, because PowerShell 5.1
# reads a BOM-less script as ANSI and would parse the 0x94 byte of an em dash as a quote.
$emDash = [char]0x2014
if (-not $ValidateNotesOnly) { Write-Host "claude-control: $current -> $next" -ForegroundColor Cyan }

# --- for a promoted release: validate the notes BEFORE touching the manifest -----------
$changelog = ''
$unreleased = $null
$notes = ''
if ($PromoteUnreleased) {
    if (-not (Test-Path $changelogPath)) { throw "not found: $changelogPath" }
    $changelog = Get-Content -Path $changelogPath -Raw -Encoding UTF8

    # \r must be consumed explicitly (.NET's $ matches before \n, so a CRLF file would not
    # match), but not \s* - that would swallow the blank line after the heading.
    $unreleased = [regex]::Match($changelog, '(?m)^##[ \t]+\[?Unreleased\]?[ \t\r]*$')
    if (-not $unreleased.Success) {
        throw "CHANGELOG.md has no '## Unreleased' heading - a release needs its notes there"
    }

    $bodyStart = $unreleased.Index + $unreleased.Length
    $rest = $changelog.Substring($bodyStart)
    $nextHeading = [regex]::Match($rest, '(?m)^##\s')
    if ($nextHeading.Success) { $notes = $rest.Substring(0, $nextHeading.Index) } else { $notes = $rest }

    $notes = ([regex]::Replace($notes, '(?s)<!--.*?-->', '')).Trim()
    if (-not $notes) {
        throw "'## Unreleased' in CHANGELOG.md is empty - write the release notes there, or mark the change chore:/docs: so it does not trigger a release"
    }
    # Only the placeholders a template leaves behind - a literal <name> in prose is fine.
    if ($notes -match '(?i)<(what|todo|tbd|fixme)[^>]*>') {
        throw "'## Unreleased' in CHANGELOG.md still holds the placeholder '$($Matches[0])' - replace it with real notes"
    }
    if ($notes -notmatch '(?m)^\s*[-*]\s+\S') {
        throw "'## Unreleased' in CHANGELOG.md has no bullet list - write the notes as '- ...' items"
    }
}

if ($ValidateNotesOnly) {
    $count = ([regex]::Matches($notes, '(?m)^\s*[-*]\s+\S')).Count
    Write-Host "claude-control: '## Unreleased' holds $count note(s) - releasable" -ForegroundColor Green
    return
}

# --- package.json: replace only the version value, keep formatting ---------------------
$versionPattern = '("version"\s*:\s*")' + [regex]::Escape($current) + '(")'
if ($manifestText -notmatch $versionPattern) {
    throw "could not find the version '$current' in package.json - fix it by hand"
}
$manifestText = [regex]::Replace($manifestText, $versionPattern, "`${1}$next`${2}")
Write-TextFile -Path $manifestPath -Text $manifestText
Write-Host '  updated package.json'

# --- package-lock.json: the root package's two version fields -------------------------
# electron-builder reads package.json, but a lockfile whose version disagrees makes
# `npm ci` rewrite it and dirties the release commit's tree.
#
# Anchored on `"name": "claude-control"` and NOT on the current version, for two reasons:
# no dependency carries that name, so this cannot hit the coincidental `"version": "0.1.0"`
# of an unrelated package the way a bare version match does; and the lockfile's root version
# is allowed to have drifted from package.json (it read 0.0.0 against a manifest at 0.1.0
# before the first release), which a version-matching pattern would silently skip.
$lockPath = Join-Path $repoRoot 'package-lock.json'
if (Test-Path $lockPath) {
    $lockText = Get-Content -Path $lockPath -Raw -Encoding UTF8
    $rootPattern = '("name"\s*:\s*"claude-control"\s*,\s*"version"\s*:\s*")\d+\.\d+\.\d+(")'
    $matched = ([regex]::Matches($lockText, $rootPattern)).Count
    if ($matched -lt 1) { throw 'could not find the root package version in package-lock.json - fix it by hand' }
    $lockText = [regex]::Replace($lockText, $rootPattern, "`${1}$next`${2}")
    Write-TextFile -Path $lockPath -Text $lockText
    Write-Host "  updated package-lock.json ($matched root version field(s))"
}

# --- CHANGELOG ------------------------------------------------------------------------
$today = (Get-Date).ToString('yyyy-MM-dd')

if ($PromoteUnreleased) {
    # Rename "## Unreleased" to the new version and leave a fresh empty section behind.
    # Heading *and* body are replaced, not just the heading: the body is rewritten as the
    # comment-stripped $notes, so the "add your changes here" template comment does not end
    # up preserved inside every released version section.
    $bodyLength = if ($nextHeading.Success) { $nextHeading.Index } else { $rest.Length }
    $replacement = "## Unreleased`r`n`r`n" +
        "<!-- Add your changes here as '- ...' items. A release is blocked while this section is empty. -->`r`n`r`n" +
        "## $next $emDash $today`r`n`r`n" + $notes + "`r`n`r`n"
    $changelog = $changelog.Remove($unreleased.Index, $unreleased.Length + $bodyLength).Insert($unreleased.Index, $replacement)
    Write-TextFile -Path $changelogPath -Text $changelog
    Write-Host "  promoted '## Unreleased' to '## $next' in CHANGELOG.md"

    if ($NotesOut) {
        Write-TextFile -Path $NotesOut -Text $notes
        Write-Host "  wrote release notes to $NotesOut"
    }

} else {
    # Manual flow: insert an empty section for the new version, to be filled in by hand.
    $section = "## $next $emDash $today`r`n`r`n### Added`r`n`r`n- <what is new>`r`n`r`n### Changed`r`n`r`n- <what changed>`r`n`r`n`r`n"

    if (Test-Path $changelogPath) {
        $changelog = Get-Content -Path $changelogPath -Raw -Encoding UTF8
        # Insert below an existing "## Unreleased" section, above the newest version.
        $firstEntry = [regex]::Match($changelog, '(?m)^##\s+(?!\[?Unreleased)')
        if ($firstEntry.Success) {
            $changelog = $changelog.Insert($firstEntry.Index, $section)
        } else {
            $changelog = $changelog.TrimEnd() + "`r`n`r`n" + $section
        }
        Write-TextFile -Path $changelogPath -Text $changelog
        Write-Host "  opened a $next section in CHANGELOG.md"
    } else {
        Write-TextFile -Path $changelogPath -Text ("# Changelog`r`n`r`n" + $section)
        Write-Host '  created CHANGELOG.md'
    }
}

# --- optional tag --------------------------------------------------------------------
if ($Tag) {
    $tagName = "v$next"
    git -C $repoRoot tag $tagName
    if ($LASTEXITCODE -eq 0) { Write-Host "  created tag $tagName (not pushed)" -ForegroundColor Green }
}

if (-not $PromoteUnreleased) {
    Write-Host ''
    Write-Host 'Next: fill in the CHANGELOG section, review the diff, then commit and push yourself.' -ForegroundColor Yellow
}
