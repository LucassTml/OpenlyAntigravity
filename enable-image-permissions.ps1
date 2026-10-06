<#
  Grants agy what it needs to generate images, find/download images on the web
  and copy/move/rename files (e.g. to put images into .md notes).

  These rules live in agy's OWN settings.json (not in the plugin), so they
  must be applied on every computer.

  Usage (in the repository folder):
    powershell -ExecutionPolicy Bypass -File .\enable-image-permissions.ps1
#>
param(
  [string]$SettingsPath = (Join-Path $HOME ".gemini\antigravity-cli\settings.json")
)
$ErrorActionPreference = "Stop"
function Ok($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [warning] $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Image and web permissions for agy" -ForegroundColor Cyan
Write-Host ""

$homeFwd = $HOME -replace '\\', '/'
$rules = New-Object System.Collections.Generic.List[string]

# Folders agy may write to (only the ones that exist on this PC)
foreach ($rel in "Documents", "Desktop", "OneDrive/Documents", "OneDrive/Desktop") {
  if (Test-Path (Join-Path $HOME $rel)) { $rules.Add("write_file($homeFwd/$rel)") }
}
# Where agy stores generated images before copying them to your folder
$rules.Add("read_file($homeFwd/.gemini/antigravity-cli/brain)")
# Read web pages
$rules.Add("read_url(*)")
# Simple file commands only; [^;|&...] blocks chaining other commands
$safe = '( [^;|&`$(){}<>]*)?$'
foreach ($cmd in "Copy-Item", "Move-Item", "Rename-Item", "New-Item -ItemType Directory", "Get-ChildItem", "Invoke-WebRequest") {
  $rules.Add("command(regex:^$cmd$safe)")
}

# Read the current settings.json (or start a new one)
if (Test-Path $SettingsPath) {
  try {
    $settings = [System.IO.File]::ReadAllText($SettingsPath) | ConvertFrom-Json
  } catch {
    Warn "$SettingsPath has a syntax error (agy ignores the whole file)."
    Warn "Fix the JSON or delete the file, then run this script again."
    exit 1
  }
  $backup = "$SettingsPath.bak-images"
  Copy-Item $SettingsPath $backup -Force
  Ok "Backup at $backup"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $SettingsPath) | Out-Null
  $settings = [pscustomobject]@{}
}

if (-not $settings.PSObject.Properties["permissions"]) {
  $settings | Add-Member -NotePropertyName permissions -NotePropertyValue ([pscustomobject]@{})
}
$existing = @()
if ($settings.permissions.PSObject.Properties["allow"]) { $existing = @($settings.permissions.allow) }
$added = @($rules | Where-Object { $existing -notcontains $_ })
$allow = @($existing) + $added
if ($settings.permissions.PSObject.Properties["allow"]) { $settings.permissions.allow = $allow }
else { $settings.permissions | Add-Member -NotePropertyName allow -NotePropertyValue $allow }

$json = $settings | ConvertTo-Json -Depth 32
[System.IO.File]::WriteAllText($SettingsPath, $json, (New-Object System.Text.UTF8Encoding $false))

# Check the result is valid JSON
try { [System.IO.File]::ReadAllText($SettingsPath) | ConvertFrom-Json | Out-Null; Ok "settings.json is valid" }
catch { Warn "Writing failed; restore the backup."; exit 1 }

if ($added.Count) { Ok "$($added.Count) rule(s) added:"; $added | ForEach-Object { Write-Host "       $_" } }
else { Ok "All rules were already present." }

Write-Host ""
Write-Host "Done. Send your next message in OpenCode (or start a new session)." -ForegroundColor Cyan
Write-Host ""
