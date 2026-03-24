@echo off
TITLE NexusWatch Pro - Debug Agent
SET INGEST_URL=https://monitoring-system-production-1e5a.up.railway.app/metrics

echo ==========================================
echo    NexusWatch Pro - Diagnostico do Agent
echo ==========================================
echo.

:: 1. Tenta encontrar o Python
echo [1/4] Verificando Python...
python --version >nul 2>&1
if %errorlevel% == 0 (
    set PY_CMD=python
) else (
    py --version >nul 2>&1
    if %errorlevel% == 0 (
        set PY_CMD=py
    ) else (
        echo [ERRO] Python nao encontrado! 
        echo Por favor, instale o Python em: https://www.python.org/downloads/
        echo Marque a opcao "Add Python to PATH" na instalacao.
        pause
        exit /b
    )
)
echo Python detectado como: %PY_CMD%

:: 2. Instala dependencias
echo [2/4] Instalando bibliotecas necessarias...
%PY_CMD% -m pip install requests psutil
if %errorlevel% neq 0 (
    echo [AVISO] Falha ao instalar dependencias automaticamente. 
    echo Tentando rodar mesmo assim...
)

:: 3. Pede o Token
echo.
if "%DEVICE_TOKEN%"=="" (
    set /p TOKEN="[3/4] Cole o TOKEN do dispositivo aqui: "
) else (
    set TOKEN=%DEVICE_TOKEN%
)

if "%TOKEN%"=="" (
    echo [ERRO] Voce precisa colar o Token que pegou no Painel Web!
    pause
    exit /b
)

:: 4. Inicia
echo.
echo [4/4] Iniciando Local Agent...
echo Encontrando CAMERA em 192.168.0.102...
echo.
set DEVICE_TOKEN=%TOKEN%
%PY_CMD% local_agent.py

echo.
echo [INFO] O Agent parou de rodar.
pause
