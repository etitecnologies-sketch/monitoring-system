#!/bin/sh

# Iniciar o daemon do Tailscale em background (userspace-networking para Railway)
tailscaled --state=/config/tailscaled.state --socket=/run/tailscale/tailscaled.sock --tun=userspace-networking &

# Esperar o daemon estar pronto
sleep 5

# Autenticar com a AuthKey do Tailscale
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Autenticando no Tailscale (VPN Server)..."
    tailscale --socket=/run/tailscale/tailscaled.sock up --authkey=$TAILSCALE_AUTHKEY --hostname=nexuswatch-vpn --accept-routes
else
    echo "ERRO: Variável TAILSCALE_AUTHKEY não definida!"
    exit 1
fi

# Manter o container rodando
echo "VPN NexusWatch ativa e conectada!"
tailscale --socket=/run/tailscale/tailscaled.sock status
wait
