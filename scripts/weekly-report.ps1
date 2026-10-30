# Writes the week's briefing to a folder on this machine.
#
# The collection itself runs on GitHub every Sunday; this only reads what it
# published and lays the report down as a dated file. Splitting it that way
# means the PC does not have to be awake for the collection, only for the
# copy - and if it was asleep on Monday, the next run still writes the file,
# because the briefing is named for the week it covers, not for the day it
# was written.
#
# Run it by hand any time:
#   powershell -ExecutionPolicy Bypass -File scripts\weekly-report.ps1

param(
  [string]$OutDir = "$env:USERPROFILE\Desktop\슈즈사이트보고"
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# Pull the week's published data. A failure here is not fatal: an older
# checkout still produces a report, and saying so beats writing nothing.
try {
  git fetch --quiet origin main
  git merge --quiet --ff-only origin/main
} catch {
  Write-Warning "최신 데이터를 받지 못했습니다. 로컬에 있는 데이터로 작성합니다. ($_)"
}

node scripts/weekly-briefing.mjs --out $OutDir
