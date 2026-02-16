# Clean WhatsApp authentication data and sessions
Stop-Process -Name node -ErrorAction SilentlyContinue
Remove-Item -Path ".wwebjs_auth_local" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "baileys_auth" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Auth data cleared. You will need to scan QR code again." -ForegroundColor Cyan