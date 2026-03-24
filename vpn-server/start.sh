#!/bin/sh

# Iniciar o daemon do Tailscale em background
tailscaled --state=/config/tailscaled.state --socket=/run/tailscale/tailscaled.sock &

# Esperar o daemon estar pronto
sleep 5

# Autenticar com a AuthKey do Tailscale
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Autenticando no Tailscale..."
    tailscale up --authkey=$TAILSCALE_AUTHKEY --hostname=nexuswatch-vpn --accept-routes
else
    echo "ERRO: Variável TAILSCALE_AUTHKEY não definida!"
    exit 1
fi

# Manter o container rodando
echo "VPN NexusWatch ativa e conectada!"
tailscale status
wait
