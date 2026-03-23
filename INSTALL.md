# 📦 Scripts de Instalação Automática

## Opções para Instalar o Projeto

Escolha uma das opções abaixo baseado no seu sistema operacional:

---

## 🪟 **Windows**

### Opção 1: PowerShell (Recomendado)
```powershell
# Abra PowerShell como Administrador e execute:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\install.ps1
```

### Opção 2: Python (Cross-platform)
```cmd
python install.py
```

---

## 🍎 **macOS / Linux**

### Opção 1: Bash Script
```bash
chmod +x install.sh
./install.sh
```

### Opção 2: Python (Cross-platform)
```bash
python3 install.py
```

### Opção 3: Makefile (Mais direto)
```bash
make install
```

---

## 🚀 **Após a Instalação**

### 1️⃣ Configure o .env
Edite o arquivo `.env` com suas senhas e URLs:

```bash
# Importante configurar:
DATABASE_URL=postgresql://user:password@localhost:5432/monitoring
JWT_SECRET=sua-chave-super-secreta-aqui
TELEGRAM_TOKEN=seu-bot-token
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-senha-app
```

### 2️⃣ Inicie os Serviços

**Opção A: Com Docker (Recomendado para produção)**
```bash
docker-compose up -d
```

**Opção B: Com Makefile (Desenvolvimento)**
```bash
make dev
```

**Opção C: Manual**
```bash
# Terminal 1 - Ingest API
cd ingest-api
npm start

# Terminal 2 - WebSocket Server
cd websocket-server
npm start

# Terminal 3 - Frontend
cd frontend
npm run dev

# Terminal 4 - Processor
cd processor
python main.py
```

### 3️⃣ Acesse o Dashboard
- **Frontend**: http://localhost (ou http://localhost:5173 em dev)
- **API**: http://localhost:3000
- **WebSocket**: http://localhost:3001

---

## ✅ O que cada Script Instala

### install.sh (Linux/macOS)
- ✓ Node.js (verifica)
- ✓ Python (verifica)
- ✓ npm root dependencies
- ✓ ingest-api dependencies
- ✓ websocket-server dependencies
- ✓ frontend dependencies
- ✓ processor Python requirements
- ✓ Cria .env de .env.example

### install.ps1 (Windows PowerShell)
- ✓ Node.js (verifica)
- ✓ Python (verifica - opcional)
- ✓ npm root dependencies
- ✓ ingest-api dependencies
- ✓ websocket-server dependencies
- ✓ frontend dependencies
- ✓ processor Python requirements (se disponível)
- ✓ Cria .env de .env.example

### install.py (Cross-platform)
- ✓ Node.js (verifica)
- ✓ Python (verifica - opcional)
- ✓ npm root dependencies
- ✓ ingest-api dependencies
- ✓ websocket-server dependencies
- ✓ frontend dependencies
- ✓ processor Python requirements
- ✓ Cria .env de .env.example

---

## 🆘 Troubleshooting

### "Node.js não encontrado"
- **Solução**: Instale Node.js 18+ de https://nodejs.org/

### "npm ERR! code ENOENT"
- **Solução**: Delete `node_modules` e `package-lock.json`, rode o script novamente

### "ModuleNotFoundError" no Python
- **Solução**: Execute `pip install -r processor/requirements.txt` manualmente

### PowerShell: "não é digitalmente assinado"
- **Solução**: Execute `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### Docker não funciona
- **Solução**: Instale Docker Desktop de https://www.docker.com/

---

## 📋 Resumo de Comandos Úteis

```bash
# Instalação
make install          # Instala todas as dependências
./install.sh          # Script Bash
python install.py     # Script Python
.\install.ps1         # Script PowerShell

# Desenvolvimento
make dev              # Inicia todos os serviços
make logs             # Vê os logs
make down             # Para os serviços

# Produção
docker-compose build  # Build das imagens
docker-compose up -d  # Inicia em background

# Linting & Tests
make lint             # Roda linter
make test             # Roda testes

# Utilidades
make clean            # Remove containers e volumes
make ps               # Lista serviços
make restart          # Reinicia tudo
```

---

## 📝 Dicas Importantes

1. **Variáveis de Ambiente**: Sempre configure `.env` antes de iniciar
2. **Banco de Dados**: PostgreSQL deve estar disponível (via Docker ou instalado)
3. **Ports**: Verifique se as portas 3000, 3001, 5432 estão livres
4. **Permissões**: No Linux/macOS, pode precisar de `sudo` para Docker

---

## 🎯 Status da Instalação

Após rodar qualquer script de instalação, verifique:

```bash
# Health check
curl http://localhost:3000/health
curl http://localhost:3001/health

# Logs
docker-compose logs -f
```

Pronto! 🚀 Its working!
