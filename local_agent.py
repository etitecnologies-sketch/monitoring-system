import os, time, logging, requests, subprocess, datetime, socket

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("LocalAgent")

# --- CONFIGURAÇÃO ---
# Cole aqui a URL da sua API no Railway
INGEST_URL = os.getenv("INGEST_URL", "https://monitoring-system-production-1e5a.up.railway.app/metrics")
# Cole aqui o TOKEN do dispositivo que você criou no painel
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN", "")
# Intervalo de envio (segundos)
INTERVAL = int(os.getenv("INTERVAL", "10"))

def get_hostname():
    return socket.gethostname()

def ping_device(ip):
    try:
        # Comando de ping para Windows (-n 1) ou Linux (-c 1)
        param = "-n" if os.name == "nt" else "-c"
        command = ["ping", param, "1", "-w", "2000", ip]
        start = time.time()
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        latency = round((time.time() - start) * 1000, 2)
        return result.returncode == 0, latency
    except:
        return False, 0

def collect_local_metrics():
    """Coleta métricas reais do Windows e faz ping nos dispositivos locais"""
    metrics = {
        "host": get_hostname(),
        "cpu": 0,
        "memory": 0,
        "disk_percent": 0,
        "uptime_seconds": 0,
        "latency_ms": 0
    }
    
    try:
        import psutil
        metrics["cpu"] = psutil.cpu_percent(interval=1)
        metrics["memory"] = psutil.virtual_memory().percent
        metrics["disk_percent"] = psutil.disk_usage('/').percent
        metrics["uptime_seconds"] = int(time.time() - psutil.boot_time())
    except ImportError:
        logger.warning("psutil não instalado. Usando métricas básicas.")

    # --- MONITORAMENTO DE DISPOSITIVOS LOCAIS (CÂMERAS, ETC) ---
    # Aqui você pode listar os IPs que o Agent deve vigiar
    devices_to_ping = ["192.168.0.102"] # Sua câmera
    
    for ip in devices_to_ping:
        alive, lat = ping_device(ip)
        if alive:
            logger.info(f"🛰️ Dispositivo {ip} está ONLINE ({lat}ms)")
            # Envia o status da câmera como uma métrica separada
            # O ID do host será o IP da câmera para o painel reconhecer
            camera_metrics = {
                "host": f"CAMERA_{ip.split('.')[-1]}",
                "latency_ms": lat,
                "status": "online"
            }
            send_to_api(camera_metrics)
            
    return metrics

def send_to_api(data):
    try:
        headers = {"Content-Type": "application/json", "X-Device-Token": DEVICE_TOKEN}
        requests.post(INGEST_URL, json=data, headers=headers, timeout=5)
    except:
        pass

def run_agent():
    if not DEVICE_TOKEN:
        logger.error("ERRO: DEVICE_TOKEN não configurado! Crie um device no painel e pegue o token.")
        return

    logger.info(f"Iniciando Local Agent para {get_hostname()}...")
    logger.info(f"Enviando para: {INGEST_URL}")

    while True:
        try:
            # 1. Coleta dados locais
            metrics = collect_local_metrics()
            
            # 2. Envia para a API
            headers = {
                "Content-Type": "application/json",
                "X-Device-Token": DEVICE_TOKEN
            }
            
            response = requests.post(INGEST_URL, json=metrics, headers=headers, timeout=10)
            
            if response.status_code in [200, 201]:
                logger.info("✓ Métricas enviadas com sucesso!")
            else:
                logger.error(f"x Erro na API: {response.status_code} - {response.text}")

        except Exception as e:
            logger.error(f"x Erro no Agent: {e}")
        
        time.sleep(INTERVAL)

if __name__ == "__main__":
    run_agent()
