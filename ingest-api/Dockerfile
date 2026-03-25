FROM node:20-alpine
WORKDIR /app

# Instalar dependências básicas
RUN apk add --no-cache ca-certificates

COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
# Iniciar a API do Node.js diretamente
CMD ["node", "index.js"]
