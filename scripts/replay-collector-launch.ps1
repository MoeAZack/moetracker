$ErrorActionPreference = "Stop"
$appDir = Join-Path $env:LOCALAPPDATA "MoeTracker\ReplayCollector\app"
$collector = Join-Path $appDir "replay-collector.mjs"
$log = Join-Path (Split-Path $appDir -Parent) "collector.log"
if (-not (Test-Path -LiteralPath $collector -PathType Leaf)) { throw "MoeTracker replay collector is not installed." }
$node = (Get-Command node -ErrorAction Stop).Source
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1048576) {
  Move-Item -LiteralPath $log -Destination "$log.previous" -Force
}
& $node $collector watch *>> $log
exit $LASTEXITCODE
