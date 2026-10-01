@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo Encerrando Automation Platform local...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Stop-Local-Test.ps1" -SourceRoot "%CD%"
echo.
pause
