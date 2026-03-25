FROM python:3.11-slim

# Instalar dependências de rede e Tailscale
RUN apt-get update && apt-get install -y --no-install-recommends \
    iputils-ping \
    snmp \
    curl \
    ca-certificates \
    iptables \
    ip6tables \
    && curl -fsSL https://tailscale.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
COPY solar_monitor.py .
COPY start.sh .
RUN chmod +x start.sh

CMD ["./start.sh"]
