# Stops the Reels Autopilot web app running on port 4600.
$conn = Get-NetTCPConnection -LocalPort 4600 -State Listen -ErrorAction SilentlyContinue
if (-not $conn) { "Reels Autopilot is not running."; return }
foreach ($id in ($conn.OwningProcess | Sort-Object -Unique)) {
    & taskkill.exe /PID $id /T /F | Out-Null
}
"Reels Autopilot stopped."
