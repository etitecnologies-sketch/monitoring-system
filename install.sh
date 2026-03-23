#!/bin/bash

# Monitoring System - Installation Script
# Instala todas as dependências e configura o projeto

set -e  # Exit on error

echo "╔════════════════════════════════════════════════════╗"
echo "║  Monitoring System - Setup Automático              ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Node.js is installed
echo -e "${BLUE}[1/6] Verificando Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}⚠ Node.js não encontrado. Por favor, instale Node.js 18+${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Check if Python is installed
echo -e "${BLUE}[2/6] Verificando Python...${NC}"
if ! command -v python3 &> /dev/null; then
    echo -e "${YELLOW}⚠ Python3 não encontrado. Por favor, instale Python 3.8+${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Python $(python3 --version)${NC}"

# Install root dependencies
echo ""
echo -e "${BLUE}[3/6] Instalando dependências da raiz...${NC}"
npm install
echo -e "${GREEN}✓ Raiz instalada${NC}"

# Install ingest-api dependencies
echo ""
echo -e "${BLUE}[4/6] Instalando ingest-api...${NC}"
cd ingest-api
npm install
cd ..
echo -e "${GREEN}✓ Ingest-API instalada${NC}"

# Install websocket-server dependencies
echo ""
echo -e "${BLUE}[5/6] Instalando websocket-server...${NC}"
cd websocket-server
npm install
cd ..
echo -e "${GREEN}✓ WebSocket Server instalado${NC}"

# Install frontend dependencies
echo ""
echo -e "${BLUE}[6/6] Instalando frontend...${NC}"
cd frontend
npm install
cd ..
echo -e "${GREEN}✓ Frontend instalado${NC}"

# Install processor dependencies
echo ""
echo -e "${BLUE}[7/7] Instalando dependências Python...${NC}"
cd processor
pip install -r requirements.txt
cd ..
echo -e "${GREEN}✓ Processor Python instalado${NC}"

# Create .env if doesn't exist
echo ""
echo -e "${BLUE}Configurando variáveis de ambiente...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${YELLOW}⚠ .env criado de .env.example - configure as senhas!${NC}"
else
    echo -e "${GREEN}✓ .env já existe${NC}"
fi

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo -e "║  ${GREEN}✓ Setup Completo!${NC}                              ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo -e "${BLUE}Próximos passos:${NC}"
echo "1. Configure as variáveis no arquivo .env"
echo ""
echo -e "${BLUE}Para iniciar em desenvolvimento:${NC}"
echo "   make dev"
echo ""
echo -e "${BLUE}Ou com Docker:${NC}"
echo "   docker-compose up -d"
echo ""
