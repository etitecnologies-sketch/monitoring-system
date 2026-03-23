# Deploy Gratuito no Railway 🚀

Railway oferece $5/mês de crédito grátis — suficiente para rodar este projeto 24/7.

## Passo a passo

### 1. Criar conta
Acesse https://railway.app e faça login com GitHub.

### 2. Instalar Railway CLI (PowerShell)
```powershell
iwr -useb https://railway.app/install.ps1 | iex
```

### 3. Login no Railway
```powershell
railway login
```

### 4. Criar projeto
```powershell
cd "C:\Users\EZEQUIEL LIMA GUIDA\Desktop\monitoring-system"
railway init
```

### 5. Adicionar banco TimescaleDB
No painel do Railway (railway.app):
- Clique em "New Service" → "Database" → "PostgreSQL"
- Anote a DATABASE_URL gerada

### 6. Configurar variáveis de ambiente
No painel Railway → seu projeto → Variables:
```
DB_PASSWORD=sua-senha-forte
JWT_SECRET=string-aleatoria-longa-aqui
CORS_ORIGIN=https://seu-projeto.up.railway.app
SMTP_HOST=smtp.gmail.com        # opcional
SMTP_USER=seu@gmail.com         # opcional
SMTP_PASS=sua-app-password      # opcional
ALERT_EMAIL=destino@gmail.com   # opcional
```

### 7. Deploy
```powershell
railway up
```

### 8. Abrir no navegador
```powershell
railway open
```

## Dicas importantes

- **WebSocket**: No Railway, a URL pública muda. Após o deploy, 
  atualize VITE_WEBSOCKET_URL no frontend com a URL do serviço websocket.

- **Domínio grátis**: Railway gera URLs tipo `projeto.up.railway.app`

- **Sempre online**: Railway mantém os serviços rodando 24/7 
  enquanto houver créditos.

- **Monitorar gastos**: Acesse railway.app/account/billing

## Alternativa: Render.com

1. Acesse https://render.com
2. "New" → "Web Service" → conecte seu GitHub
3. Configure cada serviço separadamente
4. Plano gratuito dorme após 15min de inatividade
   (Railway é melhor para este caso)
