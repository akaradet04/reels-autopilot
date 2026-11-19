# Starts the Reels Autopilot web app on http://localhost:4600 in the background (if not already running),
# then opens it in the default browser. Run with -NoBrowser to only start the server.
param([switch]$NoBrowser)

$port = 4600
$web = Join-Path $PSScriptRoot "web"
$logs = Join-Path $PSScriptRoot "logs"

function Test-Running { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

if (-not (Test-Running)) {
    New-Item -ItemType Directory -Force -Path $logs | Out-Null
    if (-not (Test-Path (Join-Path $web ".next\BUILD_ID"))) {
        & cmd.exe /c "cd /d `"$web`" && npm run build > `"$logs\build.log`" 2>&1"
    }
    Start-Process -FilePath "cmd.exe" -WorkingDirectory $web -WindowStyle Hidden `
        -ArgumentList "/c npm run start -- -p $port > `"$logs\web.log`" 2>&1"
    for ($i = 0; $i -lt 60 -and -not (Test-Running); $i++) { Start-Sleep -Seconds 1 }
}

if (-not $NoBrowser) { Start-Process "http://localhost:$port" }
