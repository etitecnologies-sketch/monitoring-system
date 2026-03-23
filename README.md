# 📡 Monitoring System

Sistema de monitoramento de infraestrutura estilo Zabbix, construído com stack moderna e pronto para produção.

## 🚀 Instalação Rápida

### Windows
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\install.ps1
```

### macOS / Linux
```bash
chmod +x install.sh
./install.sh
```

### Cross-platform (Windows, macOS, Linux)
```bash
python install.py
```

Para instruções detalhadas, veja [INSTALL.md](INSTALL.md)

## Arquitetura

```
[Hosts] --> [Agent Go] --> [Ingest API Node.js] --> [TimescaleDB]
                                    |                     |
                             [WebSocket Server]    [Processor Python]
                                    |                     |
                             [Frontend React]       [Alerts Table]
```

## Componentes

| Serviço | Tecnologia | Porta | Função |
|---|---|---|---|
| `agent` | Go | — | Coleta CPU/RAM e envia métricas |
| `ingest-api` | Node.js + Express | 3000 | Recebe e persiste métricas |
| `processor` | Python | — | Avalia triggers e dispara alertas |
| `websocket` | Node.js + Socket.IO | 3001 | Push realtime ao frontend |
| `frontend` | React + Vite | 80 | Dashboard de visualização |
| `db` | TimescaleDB | 5432 | Armazenamento de séries temporais |

## Início rápido (Docker Compose)

```bash
# 1. Clone e configure variáveis
cp .env.example .env
# Edite .env com suas senhas

# 2. Suba tudo
docker compose up --build -d

# 3. Acesse
# Dashboard: http://localhost
# API:       http://localhost:3000
# WS:        http://localhost:3001
```

## Deploy em Kubernetes

```bash
# 1. Crie o namespace
kubectl apply -f k8s/namespace.yaml

# 2. Crie os secrets (edite antes!)
kubectl apply -f k8s/secrets.yaml

# 3. Suba os serviços
kubectl apply -f k8s/

# 4. Verifique
kubectl get pods -n monitoring
```

## Variáveis de ambiente

| Variável | Serviço | Descrição |
|---|---|---|
| `DATABASE_URL` | ingest-api, processor | Connection string PostgreSQL |
| `WEBSOCKET_URL` | ingest-api | URL interna do WebSocket |
| `INGEST_URL` | agent | URL da Ingest API |
| `EVAL_INTERVAL` | processor | Intervalo de avaliação em segundos |
| `VITE_WEBSOCKET_URL` | frontend | URL pública do WebSocket |
| `DB_PASSWORD` | db | Senha do banco |

## Endpoints da API

```
POST /metrics          Recebe uma métrica
GET  /metrics/:host    Lista métricas de um host (última hora)
GET  /hosts            Lista todos os hosts
GET  /health           Health check
GET  /ready            Readiness check (verifica DB)
```

## Adicionando triggers

```sql
INSERT INTO triggers (name, expression, threshold)
VALUES ('CPU Crítico', 'cpu', 95);
```

## Estrutura de pastas

```
monitoring-system/
├── agent/              # Coletor em Go
├── ingest-api/         # API de ingestão Node.js
├── processor/          # Engine de triggers Python
├── websocket-server/   # Servidor WebSocket Node.js
├── frontend/           # Dashboard React
├── sql/                # Schema do banco
├── k8s/                # Manifests Kubernetes
├── docker-compose.yml
└── .env.example
```

## Produção — checklist obrigatório

- [ ] Trocar todas as senhas do `.env.example`
- [ ] Configurar TLS/HTTPS (cert-manager no K8s ou Nginx com Let's Encrypt)
- [ ] Adicionar autenticação JWT na Ingest API
- [ ] Configurar logs centralizados (Loki, Datadog, etc.)
- [ ] Configurar backup do TimescaleDB
- [ ] Revisar CORS_ORIGIN para seu domínio real
