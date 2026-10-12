param(
  [Parameter(Mandatory=$true)][string]$Server,
  [string]$DeviceId = ""
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20 or newer is required." }
$collector = Join-Path $PSScriptRoot "replay-collector.mjs"
if (-not (Test-Path -LiteralPath $collector -PathType Leaf)) { throw "replay-collector.mjs is missing beside this installer." }
& node $collector configure --server $Server
if ($LASTEXITCODE -ne 0) { throw "Collector configuration failed." }
if ($DeviceId) {
  & node $collector enroll --server $Server --device-id $DeviceId
  if ($LASTEXITCODE -ne 0) { throw "Collector enrollment failed." }
}
Write-Host "Installed for the current Windows user without admin rights or a background service."
Write-Host "Run: node `"$collector`" scan"
Write-Host "Start-on-login is intentionally not created automatically."
