# Deploy no Railway 🚀

Este sistema está pronto para rodar 24/7 no Railway. O projeto utiliza múltiplos serviços (frontend, backend, banco de dados) que o Railway gerencia automaticamente através do arquivo `docker-compose.yml`.

## Passo a passo para Deploy

### 1. Preparar o Repositório
- Suba este código para um repositório no seu GitHub.
- Certifique-se de que o `.gitignore` está ignorando arquivos `.env`.

### 2. Conectar ao Railway
- Acesse [railway.app](https://railway.app) e faça login com GitHub.
- Clique em **"New Project"** → **"Deploy from GitHub repo"**.
- Selecione o repositório deste projeto.

### 3. Configuração Automática
- O Railway detectará o arquivo `docker-compose.yml` e criará todos os serviços necessários:
  - `db` (TimescaleDB/PostgreSQL)
  - `ingest-api` (API Principal)
  - `websocket` (Real-time)
  - `processor` (Processamento de alertas e dados)
  - `frontend` (Painel Web)

### 4. Configurar Variáveis de Ambiente
No painel do Railway, você precisará definir algumas variáveis globais ou específicas para os serviços (em **Shared Variables** ou no serviço correspondente):

```env
DB_PASSWORD=uma-senha-segura-aqui
JWT_SECRET=uma-string-longa-e-aleatoria
CORS_ORIGIN=*
# O Railway injeta DATABASE_URL automaticamente se você usar o serviço de banco dele
```

### 5. Configurações Específicas
- **Frontend**: O Railway gera uma URL pública para o serviço `frontend`. Certifique-se de que o Nginx no frontend está configurado para apontar para os nomes internos dos serviços (já está configurado como `ingest-api:3000`).
- **WebSocket**: O frontend tentará conectar no WebSocket via URL relativa em produção.

## Por que Railway?
- **Sempre Online**: Ideal para monitoramento 24h.
- **Banco de Dados Real**: Oferece PostgreSQL/TimescaleDB persistente.
- **Escalabilidade**: Você pode escalar cada serviço individualmente se necessário.
- **SSL Automático**: Já vem com HTTPS configurado por padrão.

## Dicas para GitHub
- Nunca suba o arquivo `.env` com senhas reais.
- Use o `.env.example` como referência para outros usuários.
- O arquivo `README.md` principal já contém instruções de instalação local.
