FROM node:20-alpine
WORKDIR /app

# Instalar Tailscale e dependências de rede
RUN apk add --no-cache tailscale ca-certificates iptables ip6tables

COPY package*.json ./
RUN npm install
COPY . .

# Script de inicialização que sobe o Tailscale e depois a API
COPY start-with-vpn.sh /start-with-vpn.sh
RUN chmod +x /start-with-vpn.sh

EXPOSE 3000
CMD ["/start-with-vpn.sh"]
