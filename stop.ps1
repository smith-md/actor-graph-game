Write-Host "Stopping CineLinks..." -ForegroundColor Cyan
Write-Host ""

$ports = @(8000, 5173)
$stopped = $false

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pid in $pids) {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Stopping $($proc.ProcessName) (PID $pid) on port $port" -ForegroundColor Yellow
                Stop-Process -Id $pid -Force
                $stopped = $true
            }
        }
    } else {
        Write-Host "No process found on port $port" -ForegroundColor DarkGray
    }
}

if ($stopped) {
    Write-Host ""
    Write-Host "Servers stopped." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "No servers were running." -ForegroundColor DarkGray
}
