param([switch]$RemoveLocalManifest)
$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName "MoeTracker Replay Collector" -Confirm:$false -ErrorAction SilentlyContinue
$shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "MoeTracker Replay Collector.lnk"
if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
$collectorDir = Join-Path $env:LOCALAPPDATA "MoeTracker\ReplayCollector"
$resolvedBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "MoeTracker"))
$resolvedTarget = [IO.Path]::GetFullPath($collectorDir)
if (-not $resolvedTarget.StartsWith($resolvedBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to remove an unexpected path." }
$secret = Join-Path $resolvedTarget "device-token.dpapi"
if (Test-Path -LiteralPath $secret) { Remove-Item -LiteralPath $secret -Force }
if ($RemoveLocalManifest -and (Test-Path -LiteralPath $resolvedTarget)) { Remove-Item -LiteralPath $resolvedTarget -Recurse -Force }
Write-Host "Local device credential removed. Revoke the device in MoeTracker as well."
if (-not $RemoveLocalManifest) { Write-Host "The local manifest/config was preserved; use -RemoveLocalManifest to remove it." }
