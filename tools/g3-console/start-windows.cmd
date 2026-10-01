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

start "" "%G3_URL%"
echo G3 Console iniciando em %G3_URL%
echo Servidor continua restrito a 127.0.0.1; localhost e apenas a origem usada pelo navegador/Auth.
echo Feche esta janela ou pressione Ctrl+C para encerrar.
echo.
node scripts\g3-console-server.mjs
