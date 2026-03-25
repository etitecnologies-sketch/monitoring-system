#!/bin/sh

# Iniciar o Tailscale em background se a AuthKey estiver presente
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Iniciando Tailscale (userspace-networking) no servidor da API..."
    # --tun=userspace-networking é essencial para rodar em containers sem /dev/net/tun (Railway)
    tailscaled --state=/tmp/tailscaled.state --socket=/tmp/tailscaled.sock --tun=userspace-networking &
    
    # Tenta autenticar em background com timeout para não travar a API
    (
      sleep 5
      echo "Autenticando no Tailscale em background..."
      # --socks5-server=1055 é essencial para o Node.js falar com a rede local
    tailscale --socket=/tmp/tailscaled.sock up --authkey=$TAILSCALE_AUTHKEY --hostname=nexuswatch-api --accept-routes --socks5-server=1055
    echo "API Conectada à Rede Privada Tailscale com Proxy SOCKS5!"
    ) &
else
    echo "Aviso: TAILSCALE_AUTHKEY não definida. Rodando sem VPN..."
fi

# Iniciar a API do Node.js
echo "Iniciando Ingest API..."
node index.js
