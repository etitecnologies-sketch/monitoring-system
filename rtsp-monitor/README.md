# RTSP Monitor

Esse serviço monitora streams RTSP (por canal) e gera eventos `videoloss_started` / `videoloss_stopped` via `POST /push`.

## Configurar pelo sistema

1. No painel, edite o device e preencha a seção **RTSP (Perda/Travamento de Vídeo)**.
2. Rode o serviço com `COLLECTOR_KEY` apontando para a mesma chave do `ingest-api`.

## Variáveis de ambiente

- `INGEST_API_URL` (ex.: `http://ingest-api:3000`)
- `COLLECTOR_KEY` (obrigatório)
- `CLIENT_ID` (opcional)
- `REMOTE_REFRESH_SECONDS` (padrão 60)
- `DEFAULT_TIMEOUT_SECONDS` (padrão 8)
- `DEFAULT_INTERVAL_SECONDS` (padrão 30)

