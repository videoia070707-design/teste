@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"

set "RUNID=%RANDOM%-%RANDOM%"
set "REPORTBASE=%~dp0Relatorios-Teste-Local"
set "OUTDIR=%REPORTBASE%\Teste-%RUNID%"
md "%OUTDIR%" >nul 2>&1

if not exist "%OUTDIR%" (
  set "OUTDIR=%TEMP%\Automation-Platform-Teste-%RUNID%"
  md "%OUTDIR%" >nul 2>&1
)

set "LOG=%OUTDIR%\CONSOLE_OUTPUT.log"
> "%LOG%" echo [Automation Platform] Inicio do teste local Windows
>>"%LOG%" echo Source: %CD%
>>"%LOG%" echo WorkDir: %OUTDIR%
>>"%LOG%" echo Date: %DATE% %TIME%
>>"%LOG%" echo.

echo ============================================================
echo AUTOMATION PLATFORM - TESTE LOCAL WINDOWS
echo ============================================================
echo.
echo Relatorios: %OUTDIR%
echo.

echo [1/3] Verificando PowerShell...
where powershell.exe >>"%LOG%" 2>&1
if errorlevel 1 goto :NO_POWERSHELL

start "" explorer.exe "%OUTDIR%" >nul 2>&1

echo [2/3] Validando sintaxe dos scripts Windows...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Test-PowerShellSyntax.ps1" -DirectoryPath ".\scripts\windows" >>"%LOG%" 2>&1
if errorlevel 1 goto :PARSER_FAIL

echo [3/3] Rodando auditoria completa e iniciando localhost...
echo.
echo Esse teste pode baixar a imagem postgres:16-alpine na primeira execucao.
echo Nao feche esta janela enquanto a auditoria estiver em andamento.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Start-Local-Test.ps1" -SourceRoot "%CD%" -WorkDir "%OUTDIR%" -ConsoleLog "%LOG%"
set "ERR=%ERRORLEVEL%"
goto :AFTER_RUN

:NO_POWERSHELL
set "ERR=9009"
> "%OUTDIR%\HOMOLOGATION_ERROR.txt" echo PowerShell nao foi encontrado no Windows.
>>"%OUTDIR%\HOMOLOGATION_ERROR.txt" echo Consulte CONSOLE_OUTPUT.log.
goto :AFTER_RUN

:PARSER_FAIL
set "ERR=2"
> "%OUTDIR%\HOMOLOGATION_ERROR.txt" echo Erro de sintaxe detectado em um script PowerShell. O teste foi bloqueado antes da execucao.
>>"%OUTDIR%\HOMOLOGATION_ERROR.txt" echo Consulte CONSOLE_OUTPUT.log.
goto :AFTER_RUN

:AFTER_RUN
if not exist "%OUTDIR%\RESULTADO.txt" (
  > "%OUTDIR%\RESULTADO.txt" echo AUTOMATION PLATFORM - TESTE LOCAL WINDOWS
  >>"%OUTDIR%\RESULTADO.txt" echo Codigo de saida: %ERR%
  >>"%OUTDIR%\RESULTADO.txt" echo Relatorios: %OUTDIR%
)

echo.
echo ============================================================
echo RESULTADO
echo ============================================================
if "%ERR%"=="0" (
  echo Status: PASS
  echo Dashboard local: http://127.0.0.1:3000
  echo Para encerrar: PARAR-FERRAMENTA-WINDOWS.cmd
) else (
  echo Status: FALHA ^(codigo %ERR%^)
  echo Consulte CONSOLE_OUTPUT.log e RESULTADO.txt.
)
echo.
echo Relatorios: %OUTDIR%
echo Log: %LOG%
echo.
start "" explorer.exe "%OUTDIR%" >nul 2>&1
if "%ERR%"=="0" start "" "http://127.0.0.1:3000" >nul 2>&1
pause
exit /b %ERR%
