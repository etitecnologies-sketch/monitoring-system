@echo off
REM Monitoring System - Installation Script for Windows
REM Clique duas vezes para executar

setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════╗
echo ║  Monitoring System - Windows Setup                 ║
echo ╚════════════════════════════════════════════════════╝
echo.

REM Check Node.js
echo [1/6] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ✗ Node.js nao encontrado!
    echo Por favor, instale Node.js 18+ de https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✓ Node.js %NODE_VERSION% encontrado
echo.

REM Check npm
echo [2/6] Verificando npm...
npm --version >nul 2>&1
if errorlevel 1 (
    echo ✗ npm nao encontrado!
    pause
    exit /b 1
)
echo ✓ npm encontrado
echo.

REM Install root
echo [3/6] Instalando dependencias da raiz...
call npm install
if errorlevel 1 (
    echo ✗ Erro ao instalar dependencias da raiz
    pause
    exit /b 1
)
echo ✓ Raiz instalada
echo.

REM Install ingest-api
echo [4/6] Instalando ingest-api...
cd ingest-api
call npm install
if errorlevel 1 (
    echo ✗ Erro ao instalar ingest-api
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✓ Ingest-API instalada
echo.

REM Install websocket-server
echo [5/6] Instalando websocket-server...
cd websocket-server
call npm install
if errorlevel 1 (
    echo ✗ Erro ao instalar websocket-server
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✓ WebSocket Server instalado
echo.

REM Install frontend
echo [6/6] Instalando frontend...
cd frontend
call npm install
if errorlevel 1 (
    echo ✗ Erro ao instalar frontend
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✓ Frontend instalado
echo.

REM Try to install Python (optional)
echo [7/7] Verificando Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ⚠ Python nao encontrado - Processor nao funcionara
    echo   Instale de https://www.python.org/
) else (
    echo ✓ Python encontrado
    echo Instalando dependencias Python...
    cd processor
    call python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo ⚠ Erro ao instalar Python packages
    ) else (
        echo ✓ Processor Python instalado
    )
    cd ..
)
echo.

REM Create .env
echo Configurando variaveis de ambiente...
if not exist .env (
    if exist .env.example (
        copy .env.example .env
        echo ⚠ .env criado de .env.example - CONFIGURE AS SENHAS!
    )
) else (
    echo ✓ .env ja existe
)
echo.

REM Summary
echo ╔════════════════════════════════════════════════════╗
echo ║  ✓ Setup Completo!                                 ║
echo ╚════════════════════════════════════════════════════╝
echo.
echo Proximos passos:
echo 1. Edite o arquivo .env com seus dados
echo.
echo Para iniciar em desenvolvimento:
echo    make dev
echo.
echo Ou com Docker:
echo    docker-compose up -d
echo.
pause
