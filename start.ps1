Write-Host "Starting CineLinks..." -ForegroundColor Cyan
Write-Host ""

# Start backend in a new PowerShell window
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$PSScriptRoot\backend'; .\venv\Scripts\Activate.ps1; uvicorn main:app --reload"

# Start frontend in a new PowerShell window
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$PSScriptRoot\frontend'; npm run dev"

Write-Host "Backend:  http://localhost:8000" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "Run .\stop.ps1 to stop both servers." -ForegroundColor Yellow
