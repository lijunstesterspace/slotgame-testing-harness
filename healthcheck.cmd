@echo off
setlocal
cd /d "%~dp0"
echo === AI HARNESS Health Check ===
echo.
echo [1] Vite (frontend) port 3000:
powershell -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 3; Write-Host ('  OK HTTP ' + $r.StatusCode) } catch { Write-Host ('  FAIL: ' + $_.Exception.Message) }"
echo.
echo [2] FastAPI (backend) port 8000:
powershell -Command "try { $r = Invoke-WebRequest -Uri http://localhost:8000/healthz -UseBasicParsing -TimeoutSec 3; Write-Host ('  OK ' + $r.Content) } catch { Write-Host ('  FAIL: ' + $_.Exception.Message) }"
echo.
echo [3] Ollama (local planner model) port 11434:
powershell -Command "try { $r = Invoke-WebRequest -Uri http://localhost:11434/api/tags -UseBasicParsing -TimeoutSec 3; Write-Host ('  OK HTTP ' + $r.StatusCode) } catch { Write-Host ('  FAIL: ' + $_.Exception.Message) }"
echo.
pause
endlocal
