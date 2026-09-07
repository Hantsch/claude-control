#requires -Version 5.1
<#
.SYNOPSIS
    Decides whether the app needs a release, and which semver bump, from commit messages.
.DESCRIPTION
    Looks at every commit since the last release tag (v*) and derives the bump level from
    Conventional-Commit style subjects:

        <type>!: ... | body contains "BREAKING CHANGE"  -> major
        feat: ...                                       -> minor
        chore|docs|ci|test|style|build: ...              -> no release
        anything else (fix, perf, refactor, plain text)  -> patch

    A commit whose subject or body contains [skip release] never triggers a release.
    The highest level across all commits wins. Prints key=value lines and, inside GitHub
    Actions, appends the same keys to $env:GITHUB_OUTPUT.

    This script only reports - it changes nothing.
.EXAMPLE
    pwsh -File scripts/plan-release.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

$manifestPath = Join-Path $repoRoot 'package.json'
if (-not (Test-Path $manifestPath)) { throw "not found: $manifestPath" }

$current = (Get-Content -Path $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw "current version '$current' is not semver" }
$major = [int]$Matches[1]; $minor = [int]$Matches[2]; $patch = [int]$Matches[3]

# --- commit range ---------------------------------------------------------------------
$tags = @(git -C $repoRoot tag --list 'v*' --sort=-v:refname)
$lastTag = ''
if ($tags.Count -gt 0) { $lastTag = $tags[0] }

$range = @()
if ($lastTag) { $range = @("$lastTag..HEAD") }

$rs = [char]0x1e
$us = [char]0x1f
$raw = (git -C $repoRoot log @range "--format=%s$us%b$rs") -join "`n"
$records = @($raw -split $rs | Where-Object { $_.Trim() -ne '' })

# --- derive the bump ------------------------------------------------------------------
$noReleaseTypes = @('chore', 'docs', 'ci', 'test', 'style', 'build')
$rank = @{ 'none' = 0; 'patch' = 1; 'minor' = 2; 'major' = 3 }
$level = 'none'
$reasons = @()
$considered = 0

foreach ($record in $records) {
    $parts = $record -split $us
    $subject = $parts[0].Trim() -replace "^\s*`n", ''
    $subject = ($subject -split "`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)
    if (-not $subject) { continue }
    $body = ''
    if ($parts.Count -gt 1) { $body = $parts[1] }
    $considered++

    if ("$subject $body" -match '\[skip release\]') {
        $reasons += "none    <- $subject (skip release)"
        continue
    }

    $commitLevel = 'patch'
    $type = ''
    $bang = $false
    if ($subject -match '^(?<type>[a-zA-Z]+)(\([^)]*\))?(?<bang>!)?:\s*\S') {
        $type = $Matches['type'].ToLower()
        $bang = [bool]$Matches['bang']
    }

    if ($bang -or $body -match 'BREAKING[ -]CHANGE') {
        $commitLevel = 'major'
    } elseif ($type -eq 'feat') {
        $commitLevel = 'minor'
    } elseif ($type -and $noReleaseTypes -contains $type) {
        $commitLevel = 'none'
    }

    $reasons += "$($commitLevel.PadRight(7)) <- $subject"
    if ($rank[$commitLevel] -gt $rank[$level]) { $level = $commitLevel }
}

# --- next version ---------------------------------------------------------------------
$next = $current
switch ($level) {
    'major' { $next = "$($major + 1).0.0" }
    'minor' { $next = "$major.$($minor + 1).0" }
    'patch' { $next = "$major.$minor.$($patch + 1)" }
}

# --- report ---------------------------------------------------------------------------
$since = 'the start of history'
if ($lastTag) { $since = $lastTag }

# Write-Output on purpose: callers (ci-release.ps1) capture these key=value lines.
Write-Output "since=$since"
Write-Output "commits=$considered"
Write-Output "bump=$level"
Write-Output "current=$current"
Write-Output "next=$next"
if ($reasons.Count -gt 0) {
    Write-Output 'commits:'
    foreach ($r in $reasons) { Write-Output "  $r" }
}

if ($env:GITHUB_OUTPUT) {
    $out = @(
        "bump=$level"
        "current=$current"
        "next=$next"
        "commits=$considered"
        "since=$since"
    )
    Add-Content -Path $env:GITHUB_OUTPUT -Value ($out -join "`n") -Encoding UTF8
}
