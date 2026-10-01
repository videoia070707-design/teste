@echo off
setlocal
cd /d "%~dp0\..\.."
set "G3_URL=http://localhost:3000/"

where node >nul 2>nul
if not %errorlevel%==0 (
  echo.
  echo ERRO: Node.js precisa estar instalado para iniciar o G3 Console.
  echo Nenhum servico pago e necessario.
  echo.
  pause
  exit /b 1
)

where curl >nul 2>nul
if not %errorlevel%==0 (
  echo G3 Console iniciando em %G3_URL%
  start "G3 Console Server" /min cmd /k node scripts\g3-console-server.mjs
  timeout /t 2 /nobreak >nul
  start "" "%G3_URL%"
  exit /b 0
)

echo Iniciando G3 Console local...
start "G3 Console Server" /min cmd /k node scripts\g3-console-server.mjs

for /l %%i in (1,1,20) do (
  curl --fail --silent --show-error "%G3_URL%" >nul 2>nul
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo.
echo ERRO: o G3 Console nao respondeu em 20 segundos.
echo Verifique a janela "G3 Console Server" para detalhes.
echo.
pause
exit /b 1

:ready
echo G3 Console pronto em %G3_URL%
start "" "%G3_URL%"
echo A janela do servidor foi minimizada. Feche "G3 Console Server" para encerrar.
exit /b 0
