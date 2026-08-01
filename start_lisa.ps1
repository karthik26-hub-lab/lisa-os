# Start the Python Backend silently in the background
Write-Host "Starting LISA OS Backend..." -ForegroundColor Cyan
Start-Process -NoNewWindow -FilePath "C:\Users\KARTHIK\.local\bin\uv.exe" -ArgumentList "run", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000" -WorkingDirectory "c:\Users\KARTHIK\Desktop\lisa\backend"

# Start the Tauri Frontend
Write-Host "Starting LISA OS Frontend..." -ForegroundColor Cyan
$env:Path = "C:\Users\KARTHIK\.cargo\bin;$env:Path"
Set-Location -Path "c:\Users\KARTHIK\Desktop\lisa\frontend"
npm run tauri dev
