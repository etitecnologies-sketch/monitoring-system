#!/bin/sh

# Iniciar o Tailscale em background se a AuthKey estiver presente
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Iniciando Tailscale no servidor da API..."
    tailscaled --state=/tmp/tailscaled.state --socket=/tmp/tailscaled.sock &
    sleep 5
    tailscale up --authkey=$TAILSCALE_AUTHKEY --hostname=nexuswatch-api --accept-routes
    echo "API Conectada à Rede Privada Tailscale!"
else
    echo "Aviso: TAILSCALE_AUTHKEY não definida. Rodando sem VPN..."
fi

# Iniciar a API do Node.js
echo "Iniciando Ingest API..."
node index.js
