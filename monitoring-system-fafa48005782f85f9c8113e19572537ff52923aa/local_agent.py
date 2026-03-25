import os, time, logging, requests, subprocess, datetime, socket

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("LocalAgent")

# --- CONFIGURAÇÃO ---
# Se a sua URL do Railway for diferente, altere aqui:
# Ex: https://powerful-unity-production.up.railway.app/metrics
INGEST_URL = os.getenv("INGEST_URL", "https://powerful-unity-production.up.railway.app/metrics")
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN", "2d8a7f9b-ac67-47cb-ba7c-f6b807a3712e")
# Intervalo de envio (segundos)
INTERVAL = int(os.getenv("INTERVAL", "10"))

def get_hostname():
    return socket.gethostname()

def check_port(host, port):
    """Verifica se uma porta TCP está aberta (útil para No-IP/Câmeras/Intelbras)"""
    try:
        # Tenta resolver o DNS antes para dar um log mais preciso
        try:
            ip = socket.gethostbyname(host)
            logger.debug(f"🔍 DNS Resolvido: {host} -> {ip}")
        except socket.gaierror:
            return False, 0, "DNS_ERROR"

        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5) # Aumentado para 5s para conexões remotas instáveis
        start = time.time()
        result = s.connect_ex((host, int(port)))
        latency = round((time.time() - start) * 1000, 2)
        s.close()
        
        error_type = None
        if result != 0:
            if result == 10061: error_type = "REFUSED"
            elif result == 10060: error_type = "TIMEOUT"
            else: error_type = f"ERR_{result}"
            
        return result == 0, latency, error_type
    except Exception as e:
        return False, 0, str(e)

def ping_device(ip):
    try:
        # Comando de ping para Windows (-n 1) ou Linux (-c 1)
        param = "-n" if os.name == "nt" else "-c"
        # -w 3000 aumenta o timeout para 3 segundos
        command = ["ping", param, "1", "-w", "3000", ip]
        start = time.time()
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        latency = round((time.time() - start) * 1000, 2)
        return result.returncode == 0, latency
    except:
        return False, 0

def collect_local_metrics(devices_to_check):
    """Coleta métricas reais do Windows e faz ping/check nos dispositivos da API"""
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

    # --- MONITORAMENTO DINÂMICO DOS DISPOSITIVOS ---
    for dev in devices_to_check:
        alive = False
        lat = 0
        method = "UNKNOWN"
        target = "N/A"
        error_detail = ""

        # 1. Tenta primeiro por DDNS se estiver configurado
        if dev.get("ddns_address") and dev.get("monitor_port"):
            target = dev["ddns_address"]
            port = dev["monitor_port"]
            alive, lat, err = check_port(target, port)
            method = f"TCP:{port}"
            
            if not alive:
                error_detail = f" (Erro: {err})" if err else ""
                logger.warning(f"⚠️ DDNS {target}:{port} falhou{error_detail}. Verifique o redirecionamento de porta no roteador.")
                if "DNS_ERROR" in str(err):
                    logger.error(f"❌ Erro de DNS: Não foi possível resolver o endereço {target}. Verifique se o DDNS Intelbras está ativo.")

        # 2. Se o DDNS falhou ou não existe, tenta pelo IP Local (Ping)
        if not alive and dev.get("ip_address") and dev.get("monitor_ping"):
            target = dev["ip_address"]
            alive, lat = ping_device(target)
            method = "PING"

        if not target or target == "N/A":
            continue

        # Gera um ID para o host (limpa caracteres especiais)
        safe_host_id = target.replace(".", "_").replace("-", "_")
        
        if alive:
            logger.info(f"🛰️ {dev['name']} ({target}) [{method}] está ONLINE ({lat}ms)")
            status_data = {
                "host": f"DEVICE_{safe_host_id}",
                "device_id": dev["id"],
                "latency_ms": lat,
                "status": "online",
                "cpu": 0, "memory": 0
            }
            send_to_api(status_data)
        else:
            # Só reporta offline se realmente tentou algum método
            if method != "UNKNOWN":
                logger.warning(f"❌ {dev['name']} ({target}) [{method}] está OFFLINE!{error_detail}")
                status_data = {
                    "host": f"DEVICE_{safe_host_id}",
                    "device_id": dev["id"],
                    "latency_ms": 0,
                    "status": "offline",
                    "cpu": 0, "memory": 0
                }
                send_to_api(status_data)
            
    return metrics

def send_to_api(data):
    try:
        headers = {"Content-Type": "application/json", "X-Device-Token": DEVICE_TOKEN}
        requests.post(INGEST_URL, json=data, headers=headers, timeout=5)
    except:
        pass

def fetch_devices():
    """Busca a lista de dispositivos para monitorar no painel"""
    try:
        # Remove /metrics do final para pegar a base da URL
        base_url = INGEST_URL.split("/metrics")[0]
        headers = {"X-Device-Token": DEVICE_TOKEN}
        r = requests.get(f"{base_url}/agent/devices", headers=headers, timeout=10)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        logger.error(f"Erro ao buscar dispositivos: {e}")
    return []

def run_agent():
    if not DEVICE_TOKEN:
        logger.error("ERRO: DEVICE_TOKEN não configurado! Crie um device no painel e pegue o token.")
        return

    logger.info(f"Iniciando Local Agent para {get_hostname()}...")
    logger.info(f"Enviando para: {INGEST_URL}")

    while True:
        try:
            # 1. Busca dispositivos atualizados do painel
            devices = fetch_devices()
            if devices:
                logger.info(f"Monitorando {len(devices)} dispositivo(s) do painel.")
            
            # 2. Coleta dados locais e monitora os dispositivos recebidos
            metrics = collect_local_metrics(devices)
            
            # 3. Envia métricas do próprio PC do Agent
            headers = {
                "Content-Type": "application/json",
                "X-Device-Token": DEVICE_TOKEN
            }
            
            response = requests.post(INGEST_URL, json=metrics, headers=headers, timeout=10)
        
        if response.status_code in [200, 201]:
            logger.info("✓ Métricas enviadas com sucesso!")
        elif response.status_code == 401:
            logger.error("x Token inválido! Verifique o Token no Painel.")
        elif response.status_code == 404:
            logger.error(f"x URL não encontrada: {INGEST_URL}. Verifique a URL da API.")
        else:
            logger.error(f"x Erro na API: {response.status_code} - {response.text}")

    except requests.exceptions.ConnectionError:
        logger.error(f"x Erro de conexão: Não foi possível alcançar a API em {INGEST_URL}")
    except Exception as e:
        logger.error(f"x Erro no Agent: {e}")
        
        time.sleep(INTERVAL)

if __name__ == "__main__":
    run_agent()
