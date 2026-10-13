param(
  [Parameter(Mandatory=$true)][string]$Server,
  [string]$DeviceId = "",
  [string]$VrfkitBinary = "",
  [string]$PythonPath = ""
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20 or newer is required." }
$sourceCollector = Join-Path $PSScriptRoot "replay-collector.mjs"
$sourceNormalizer = Join-Path $PSScriptRoot "normalize-vrfkit-export.py"
$sourceLauncher = Join-Path $PSScriptRoot "replay-collector-launch.ps1"
if (-not (Test-Path -LiteralPath $sourceCollector -PathType Leaf)) { throw "replay-collector.mjs is missing beside this installer." }
$installDir = Join-Path $env:LOCALAPPDATA "MoeTracker\ReplayCollector\app"
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$collector = Join-Path $installDir "replay-collector.mjs"
$normalizer = Join-Path $installDir "normalize-vrfkit-export.py"
$launcher = Join-Path $installDir "replay-collector-launch.ps1"
Copy-Item -LiteralPath $sourceCollector -Destination $collector -Force
Copy-Item -LiteralPath $sourceNormalizer -Destination $normalizer -Force
Copy-Item -LiteralPath $sourceLauncher -Destination $launcher -Force

$configure = @($collector, "configure", "--server", $Server, "--enable-auto-upload", "--stable-seconds", "10", "--scan-seconds", "5")
if ($VrfkitBinary) { $configure += @("--vrfkit-binary", $VrfkitBinary) }
if ($PythonPath) { $configure += @("--python", $PythonPath) }
$configure += @("--normalizer", $normalizer)
& node @configure
if ($LASTEXITCODE -ne 0) { throw "Collector configuration failed." }
if ($DeviceId) {
  & node $collector enroll --server $Server --device-id $DeviceId
  if ($LASTEXITCODE -ne 0) { throw "Collector enrollment failed." }
}
Unregister-ScheduledTask -TaskName "MoeTracker Replay Collector" -Confirm:$false -ErrorAction SilentlyContinue
$powershell = (Get-Command powershell.exe).Source
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "MoeTracker Replay Collector.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $installDir
$shortcut.WindowStyle = 7
$shortcut.Save()
$escapedCollector = [Regex]::Escape($collector)
$alreadyRunning = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match $escapedCollector -and $_.CommandLine -match '\bwatch\b' }
if (-not $alreadyRunning) {
  Start-Process -FilePath $powershell -ArgumentList @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "`"$launcher`"") -WindowStyle Hidden
}
Write-Host "MoeTracker Replay Collector is installed, running now, and will start automatically at Windows sign-in."
