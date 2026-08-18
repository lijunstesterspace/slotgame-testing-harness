@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "LOG=%~dp0healthcheck.log"
> "%LOG%" echo === healthcheck.cmd ===
>> "%LOG%" echo Started at: %date% %time%
>> "%LOG%" echo Working dir: %cd%

echo This is a simple script health check.
echo If you can see this window, CMD scripts are allowed to run.
echo.
echo Writing log to: healthcheck.log

echo OK >> "%LOG%"
start notepad "%LOG%"
pause

