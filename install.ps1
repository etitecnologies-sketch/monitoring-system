# Monitoring System - Installation Script for Windows
# Instala todas as dependências e configura o projeto

param(
    [switch]$SkipPythonCheck = $false
)

# Set error action
$ErrorActionPreference = "Stop"

# Colors (using Write-Host with different foreground colors)
function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
}

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  $Message" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

# Main script
Write-Header "Monitoring System - Windows Setup"

# Check Node.js
Write-Info "Verificando Node.js..."
try {
    $nodeVersion = node --version
    Write-Success "Node.js $nodeVersion encontrado"
} catch {
    Write-Warning "Node.js não encontrado. Por favor, instale Node.js 18+"
    Write-Host "Download: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check Python (optional)
if (-not $SkipPythonCheck) {
    Write-Info "Verificando Python..."
    try {
        $pythonVersion = python --version
        Write-Success "Python $pythonVersion encontrado"
    } catch {
        Write-Warning "Python não encontrado. Processor Python não funcionará"
        Write-Warning "Instalando apenas Node.js..."
    }
}

# Install root dependencies
Write-Info "Instalando dependências da raiz..."
npm install
Write-Success "Raiz instalada"

# Install ingest-api
Write-Info "Instalando ingest-api..."
Set-Location ingest-api
npm install
Set-Location ..
Write-Success "Ingest-API instalada"

# Install websocket-server
Write-Info "Instalando websocket-server..."
Set-Location websocket-server
npm install
Set-Location ..
Write-Success "WebSocket Server instalado"

# Install frontend
Write-Info "Instalando frontend..."
Set-Location frontend
npm install
Set-Location ..
Write-Success "Frontend instalado"

# Install processor Python (if Python available)
try {
    Write-Info "Instalando dependências Python..."
    Set-Location processor
    python -m pip install -r requirements.txt
    Set-Location ..
    Write-Success "Processor Python instalado"
} catch {
    Write-Warning "Não foi possível instalar dependências Python"
    Write-Warning "Execute manualmente: pip install -r processor/requirements.txt"
}

# Create .env
Write-Info "Configurando variáveis de ambiente..."
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Warning ".env criado de .env.example - CONFIGURE AS SENHAS!"
} else {
    Write-Success ".env já existe"
}

# Summary
Write-Header "✓ Setup Completo!"

Write-Host "Próximos passos:" -ForegroundColor Blue
Write-Host "1. Configure as variáveis no arquivo .env" -ForegroundColor Gray
Write-Host ""
Write-Host "Para iniciar em desenvolvimento:" -ForegroundColor Blue
Write-Host "   make dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ou com Docker:" -ForegroundColor Blue
Write-Host "   docker-compose up -d" -ForegroundColor Cyan
Write-Host ""
