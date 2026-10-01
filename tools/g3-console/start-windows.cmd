@echo off
setlocal
cd /d "%~dp0"
set "G3_URL=http://127.0.0.1:4173/"

where node >nul 2>nul
if %errorlevel%==0 (
  start "" "%G3_URL%"
  echo G3 Console iniciando em %G3_URL%
  echo Feche esta janela ou pressione Ctrl+C para encerrar.
  node serve-local.mjs
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" "%G3_URL%"
  echo G3 Console iniciando em %G3_URL%
  echo Feche esta janela ou pressione Ctrl+C para encerrar.
  py -3 -m http.server 4173 --bind 127.0.0.1 --directory "%~dp0"
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "%G3_URL%"
  echo G3 Console iniciando em %G3_URL%
  echo Feche esta janela ou pressione Ctrl+C para encerrar.
  python -m http.server 4173 --bind 127.0.0.1 --directory "%~dp0"
  goto :eof
)

echo.
echo ERRO: Node.js ou Python 3 precisa estar instalado para servir o console local.
echo Nenhum servico pago e necessario.
echo.
pause
