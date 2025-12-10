Write-Host "🛑 Stopping CineLinks..." -ForegroundColor Cyan

# Kill processes on ports 8000 and 5173
Write-Host "Stopping backend (port 8000)..." -ForegroundColor Yellow
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

Write-Host "Stopping frontend (port 5173)..." -ForegroundColor Yellow
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

Write-Host "✅ CineLinks stopped!" -ForegroundColor Green