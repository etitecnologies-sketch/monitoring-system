import os, time, logging, smtplib, requests, datetime, subprocess, html, re
from email.mime.text import MIMEText
from contextlib import contextmanager
import psycopg2
import concurrent.futures

# Configuração de fuso horário local (Brasil/Brasília)
TIMEZONE_DISPLAY = datetime.timezone(datetime.timedelta(hours=-3))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

APP_NAME        = "NexusWatch Pro"

def sanitize(val): return re.sub(r'["\'`\s]', '', val) if val else ""
def escape_html(text):
    if not text: return ""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def now_display():
    """Retorna o horário atual formatado para o Brasil"""
    return datetime.datetime.now(TIMEZONE_DISPLAY).strftime("%d/%m/%Y %H:%M:%S")

DATABASE_URL    = sanitize(os.environ.get("DATABASE_URL", ""))
EVAL_INTERVAL   = int(os.getenv("EVAL_INTERVAL", "1")) # Ciclo ultra-rápido: 1s
OFFLINE_TIMEOUT = int(os.getenv("OFFLINE_TIMEOUT", "10")) # Timeout agressivo: 10s
ALERT_COOLDOWN  = int(os.getenv("ALERT_COOLDOWN", "60"))
PING_TIMEOUT    = int(os.getenv("PING_TIMEOUT", "2"))
PING_COUNT      = int(os.getenv("PING_COUNT", "1"))

# Telegram/Email globais (superadmin)
TG_TOKEN    = sanitize(os.getenv("TELEGRAM_TOKEN", ""))
TG_CHAT_ID  = sanitize(os.getenv("TELEGRAM_CHAT_ID", ""))
SMTP_HOST   = sanitize(os.getenv("SMTP_HOST", ""))
SMTP_PORT   = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER   = sanitize(os.getenv("SMTP_USER", ""))
SMTP_PASS   = sanitize(os.getenv("SMTP_PASS", ""))
ALERT_EMAIL = sanitize(os.getenv("ALERT_EMAIL", ""))

# WhatsApp (Evolution API) globais
WA_INSTANCE = sanitize(os.getenv("WA_INSTANCE", ""))
WA_TOKEN    = sanitize(os.getenv("WA_TOKEN", ""))
WA_NUMBER   = sanitize(os.getenv("WA_NUMBER", ""))
WA_API_URL  = sanitize(os.getenv("WA_API_URL", ""))

# Limpeza e log de inicialização
print(f"DEBUG: TG_TOKEN={TG_TOKEN[:10]}... | TG_CHAT_ID={TG_CHAT_ID}")
print(f"DEBUG: DB_URL={DATABASE_URL[:20]}...")

device_online_state = {}
alert_cooldown_map  = {}
ping_state          = {}
last_summary_time   = 0
last_event_id       = 0

DEVICE_TYPE_ICONS = {
    "server":"🖥️","camera":"📷","router":"🌐","switch":"🔀",
    "routerboard":"📡","unifi":"📶","firewall":"🛡️","printer":"🖨️",
    "iot":"💡","workstation":"💻","dvr":"📹","nvr":"🎥","other":"📦",
}
SEVERITY = {
    "cpu":{"icon":"🔥","label":"CPU"},"memory":{"icon":"🧠","label":"Memória"},
    "disk_percent":{"icon":"💾","label":"Disco"},"latency_ms":{"icon":"📡","label":"Latência"},
    "load_avg":{"icon":"⚙️","label":"Load"},"temperature":{"icon":"🌡️","label":"Temp"},
}
UNITS = {"latency_ms":"ms","load_avg":"","processes":"","temperature":"°C"}
SNMP_OIDS = {
    "cpu":"1.3.6.1.4.1.2021.11.11.0","memory":"1.3.6.1.4.1.2021.4.6.0",
    "mem_total":"1.3.6.1.4.1.2021.4.5.0","mikrotik_cpu":"1.3.6.1.2.1.25.3.3.1.2.1",
    "mikrotik_mem_used":"1.3.6.1.2.1.25.2.3.1.6.1","mikrotik_mem_total":"1.3.6.1.2.1.25.2.3.1.5.1",
    "uptime":"1.3.6.1.2.1.1.3.0",
}

def get_unit(expr):  return UNITS.get(expr, "%")
def device_icon(t):  return DEVICE_TYPE_ICONS.get((t or "other").lower(), "📦")
def now_str():       return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def get_severity_level(expr, value, threshold):
    ratio = float(value)/float(threshold) if float(threshold)>0 else 2
    if ratio>=1.5: return "CRÍTICO","🔴"
    elif ratio>=1.2: return "ALTO","🟠"
    else: return "ATENÇÃO","🟡"

@contextmanager
def get_conn():
    conn = psycopg2.connect(DATABASE_URL)
    try: yield conn
    finally: conn.close()

# ── Notificações por cliente ──────────────────────────────────
def get_client_config(cur, client_id):
    """Retorna config de telegram/email/whatsapp do cliente"""
    if not client_id: return None, None, None, None, None, None, None
    try:
        cur.execute("""
            SELECT telegram_token, telegram_chat_id, alert_email, name,
                   wa_instance, wa_token, wa_number
            FROM clients WHERE id=%s
        """, (client_id,))
        row = cur.fetchone()
        if row: return row[0], row[1], row[2], row[3], row[4], row[5], row[6]
    except: pass
    return None, None, None, None, None, None, None

def send_whatsapp(message, instance=None, token=None, number=None):
    """Envia mensagem via Evolution API para o cliente ou superadmin"""
    targets = []
    # Se o cliente tem WhatsApp configurado
    if instance and token and number:
        targets.append((instance, token, number))
    
    # Se o superadmin tem WhatsApp configurado (Global)
    if WA_INSTANCE and WA_TOKEN and WA_NUMBER:
        targets.append((WA_INSTANCE, WA_TOKEN, WA_NUMBER))
    
    if not targets or not WA_API_URL: return

    for inst, tok, num in set(targets):
        try:
            url = f"{WA_API_URL.rstrip('/')}/message/sendText/{inst}"
            headers = {"Content-Type": "application/json", "apikey": tok}
            payload = {
                "number": num,
                "options": {"delay": 1200, "presence": "composing", "linkPreview": False},
                "textMessage": {"text": message}
            }
            r = requests.post(url, json=payload, headers=headers, timeout=15)
            if r.status_code in [200, 201]:
                logger.info(f"WhatsApp ✓ sent to {num}")
            else:
                logger.error(f"WhatsApp error ({r.status_code}): {r.text}")
        except Exception as e:
            logger.error(f"WhatsApp exception: {e}")

def send_telegram(message, token=None, chat_id=None):
    """Envia para o telegram do cliente ou do superadmin com tratamento de erro e escape HTML"""
    targets = []
    # Se o cliente tem Telegram configurado
    if token and chat_id:
        targets.append((str(token).strip(), str(chat_id).strip()))
    
    # Se o superadmin tem Telegram configurado (Global)
    if TG_TOKEN and TG_CHAT_ID:
        targets.append((str(TG_TOKEN).strip(), str(TG_CHAT_ID).strip()))
    
    if not targets:
        logger.error("Nenhum target de Telegram configurado!")
        return
        
    for tok, cid in set(targets):
        try:
            # Garante que o token não tenha o prefixo 'bot' duplicado
            clean_tok = tok.replace("bot", "") if tok.startswith("bot") else tok
            url = f"https://api.telegram.org/bot{clean_tok}/sendMessage"
            
            payload = {"chat_id": cid, "text": message, "parse_mode": "HTML"}
            logger.info(f"Tentando enviar Telegram para {cid}...")
            
            r = requests.post(url, json=payload, timeout=15)
            
            if r.status_code == 200:
                logger.info(f"Telegram ✓ enviado com sucesso para {cid}")
            else:
                logger.error(f"Telegram erro {r.status_code} para {cid}: {r.text}")
                # Se falhou por causa do HTML, tenta enviar como texto puro como fallback
                if "can't parse entities" in r.text.lower():
                    logger.info(f"Tentando fallback para texto puro para {cid}...")
                    payload.pop("parse_mode")
                    r2 = requests.post(url, json=payload, timeout=15)
                    if r2.status_code == 200:
                        logger.info(f"Telegram ✓ enviado com fallback (texto puro) para {cid}")
        except Exception as e:
            logger.error(f"Telegram exceção ao enviar para {cid}: {e}")

def send_email(subject, body, to_email=None):
    emails = list(set(filter(None, [to_email, ALERT_EMAIL])))
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]) or not emails: return
    for email in emails:
        try:
            msg=MIMEText(body); msg["Subject"]=subject; msg["From"]=SMTP_USER; msg["To"]=email
            with smtplib.SMTP(SMTP_HOST,SMTP_PORT) as s:
                s.starttls(); s.login(SMTP_USER,SMTP_PASS); s.sendmail(SMTP_USER,[email],msg.as_string())
            logger.info(f"Email ✓ sent to {email}")
        except Exception as e: logger.error(f"Email error: {e}")

def is_in_cooldown(host,expr): return (time.time()-alert_cooldown_map.get((host,expr),0))<ALERT_COOLDOWN
def set_cooldown(host,expr): alert_cooldown_map[(host,expr)]=time.time()

def ping(ip, timeout=3):
    if not ip: return False, 0
    try:
        start=time.time()
        result=subprocess.run(["ping","-c",str(PING_COUNT),"-W",str(timeout),ip],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=timeout+1)
        return result.returncode==0, round((time.time()-start)*1000,1)
    except: return False, 0

def snmp_get(ip, community, oid, version="2c", timeout=3):
    try:
        cmd=["snmpget","-v",version,"-c",community,"-t",str(timeout),"-r","1",ip,oid]
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout+1)
        if result.returncode!=0: return None
        parts=result.stdout.strip().split(":")
        if len(parts)>=2:
            try: return float(parts[-1].strip().split()[0])
            except: return None
    except: return None

def collect_snmp(ip, community, version="2c"):
    m={}
    cpu=snmp_get(ip,community,"1.3.6.1.2.1.25.3.3.1.2.1",version)
    if cpu is None:
        idle=snmp_get(ip,community,SNMP_OIDS["cpu"],version)
        if idle is not None: cpu=max(0,100-idle)
    if cpu is not None: m["cpu"]=cpu
    mu=snmp_get(ip,community,SNMP_OIDS["mikrotik_mem_used"],version)
    mt=snmp_get(ip,community,SNMP_OIDS["mikrotik_mem_total"],version)
    if mu and mt and mt>0: m["memory"]=(mu/mt)*100
    upt=snmp_get(ip,community,SNMP_OIDS["uptime"],version)
    if upt: m["uptime_seconds"]=int(upt/100)
    return m

def check_ping_devices(cur, conn):
    cur.execute("""SELECT d.id,d.name,d.ip_address,d.device_type,d.tags,d.status,
        d.snmp_community,d.snmp_version,d.monitor_snmp,d.hostname,d.client_id,d.ddns_address,d.monitor_port,
        d.mac_address,d.serial_number,
        (SELECT latency_ms FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_latency
        FROM devices d WHERE (d.ip_address IS NOT NULL AND d.ip_address!='' AND (d.monitor_ping=TRUE OR d.monitor_port > 0))
        OR (d.ddns_address IS NOT NULL AND d.ddns_address!='' AND d.monitor_port > 0)""")
    devices=cur.fetchall()
    if not devices: return

    def check_one(dev):
        dev_id,dev_name,ip,dtype,tags,db_status,sc,sv,do_snmp,hostname,client_id,ddns,port,mac,sn,last_latency=dev
        
        alive = False
        latency = 0
        method = "NONE"
        
        # Ignora IPs privados (192.168.x, 10.x, 172.16-31.x) pois o servidor cloud não alcança
        # Esses dispositivos serão monitorados apenas pelo 'last_seen' (Heartbeat/Push)
        is_private = ip and (ip.startswith("192.168.") or ip.startswith("10.") or ip.startswith("172."))
        
        if is_private and not ddns:
            return None # Ignora este dispositivo no monitoramento de Ping direto

        # 1. Tenta DDNS se disponível
        if ddns and port:
            import socket
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(PING_TIMEOUT)
                start = time.time()
                result = s.connect_ex((ddns, int(port)))
                latency = round((time.time() - start) * 1000, 1)
                s.close()
                if result == 0:
                    alive = True
                    method = f"TCP:{port}"
            except:
                pass
                
        # 2. Se não funcionou DDNS ou não tem, tenta TCP no IP (caso de VPN/Private IP)
        if not alive and ip and port:
            import socket
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(PING_TIMEOUT)
                start = time.time()
                result = s.connect_ex((ip, int(port)))
                latency = round((time.time() - start) * 1000, 1)
                s.close()
                if result == 0:
                    alive = True
                    method = f"VPN-TCP:{port}"
            except:
                pass

        # 3. Se ainda não funcionou ou não tem porta, tenta Ping se tiver IP
        if not alive and ip:
            alive, latency = ping(ip, PING_TIMEOUT)
            method = "PING"

        return dev_id,dev_name,ip or ddns,dtype,tags,db_status,sc,sv,do_snmp,hostname,client_id,alive,latency,method,mac,sn,last_latency

    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as ex:
        results=list(ex.map(check_one,devices))

    for r in results:
        if r is None: continue
        dev_id,dev_name,target,dtype,tags,db_status,sc,sv,do_snmp,hostname,client_id,alive,latency,method,mac,sn,last_latency=r
        d_icon=device_icon(dtype)
        tags_list=tags if tags else []
        tags_str=" ".join([f"#{t}" for t in tags_list]) if tags_list else ""
        mac_sn_str = f"MAC: {escape_html(mac)} | SN: {escape_html(sn)}\n" if mac or sn else ""
        
        # Estado atual do banco
        was_down = (db_status == 'offline')

        # Buscar config do cliente
        tg_tok, tg_cid, cl_email, cl_name, wa_inst, wa_tok, wa_num = get_client_config(cur, client_id)

        if alive:
            try:
                cur.execute("UPDATE devices SET last_seen=NOW(),status='online' WHERE id=%s",(dev_id,))
                conn.commit()
            except: conn.rollback()
            if latency>0:
                try:
                    hl=hostname or target or dev_name
                    cur.execute("INSERT INTO hosts(name) VALUES(%s) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name",(hl,))
                    cur.execute("""INSERT INTO metrics(time,host_id,host,device_id,cpu,memory,disk_used,
                        disk_total,disk_percent,net_rx_bytes,net_tx_bytes,latency_ms,uptime_seconds,load_avg,processes,temperature,status)
                        VALUES(NOW(),(SELECT id FROM hosts WHERE name=%s),%s,%s,0,0,0,0,0,0,0,%s,0,0,0,0,'online')""",
                        (hl,hl,dev_id,latency))
                    conn.commit()
                except Exception as e: logger.debug(f"Ping metric: {e}"); conn.rollback()

        if alive and was_down:
            ping_state[dev_id]=False
            logger.info(f"✅ DEVICE ONLINE: {dev_name} ({target}) via {method}")
            edev_name = escape_html(dev_name)
            etarget = escape_html(target)
            ecl_name = escape_html(cl_name) if cl_name else ""
            msg=(f"✅ <b>{edev_name}</b>\n"
                 f"Normalizado: Host <b>{etarget}</b> está respondendo via {method}\n\n"
                 f"Host: {edev_name}\n"
                 f"Latência Atual: <b>{latency:.1f}ms</b>\n"
                 f"Data da Normalização: <b>{now_display()}</b>\n"
                 f"Detalhes: {d_icon} {escape_html(dtype or 'other')} - {escape_html(mac or 'N/A')} - {escape_html(sn or 'N/A')}\n"
                 +(f"Descrição: {ecl_name}\n" if cl_name else "")
                 +(f"Tags: {escape_html(tags_str)}\n" if tags_str else ""))
            send_telegram(msg, tg_tok, tg_cid)
            send_whatsapp(msg.replace("<b>","*").replace("</b>","*"), wa_inst, wa_tok, wa_num)
            send_email(f"[{APP_NAME}] 🟢 ONLINE: {dev_name}",
                f"Device '{dev_name}' voltou ONLINE.\nAlvo: {target}\nMétodo: {method}\nLatência: {latency:.1f}ms\nMAC: {mac}\nSN: {sn}\nCliente: {cl_name or 'N/A'}\nHorário: {now_display()}", cl_email)

        elif not alive and not was_down:
            ping_state[dev_id]=True
            logger.warning(f"🚨 DEVICE OFFLINE: {dev_name} ({target})")
            try:
                cur.execute("INSERT INTO alerts(device_id,host,expression,value,threshold,alert_type,client_id) VALUES(%s,%s,'offline',1,0,'offline',%s)",(dev_id,target or dev_name,client_id))
                cur.execute("UPDATE devices SET status='offline' WHERE id=%s",(dev_id,))
                cur.execute("INSERT INTO metrics(time,host,device_id,latency_ms,status) VALUES(NOW(),%s,%s,0,'offline')", (target or dev_name, dev_id))
                conn.commit()
            except Exception as e: logger.error(f"Alert DB save error: {e}"); conn.rollback()
            edev_name = escape_html(dev_name)
            etarget = escape_html(target)
            ecl_name = escape_html(cl_name) if cl_name else ""
            msg=(f"❌ <b>{edev_name}</b>\n"
                 f"Problema: Host <b>{etarget}</b> está indisponível via {method}\n\n"
                 f"Host: {edev_name}\n"
                 f"Última Latência: <b>{last_latency if last_latency else 0:.1f}ms</b>\n"
                 f"Data do Evento: <b>{now_display()}</b>\n"
                 f"Detalhes: {d_icon} {escape_html(dtype or 'other')} - {escape_html(mac or 'N/A')} - {escape_html(sn or 'N/A')}\n"
                 +(f"Descrição: {ecl_name}\n" if cl_name else "")
                 +(f"Tags: {escape_html(tags_str)}\n" if tags_str else "")
                 +f"Indicação: Falha na conexão via {method}. Verifique o equipamento.")
            send_telegram(msg, tg_tok, tg_cid)
            send_whatsapp(msg.replace("<b>","*").replace("</b>","*"), wa_inst, wa_tok, wa_num)
            send_email(f"[{APP_NAME}] 🔴 OFFLINE: {dev_name}",
                f"Device '{dev_name}' ficou OFFLINE.\nAlvo: {target}\nÚltima Latência: {last_latency if last_latency else 0:.1f}ms\nMAC: {mac}\nSN: {sn}\nCliente: {cl_name or 'N/A'}\nHorário: {now_display()}", cl_email)

def check_offline_devices(cur, conn):
    # Usamos o relógio do BANCO DE DADOS (Postgres) para calcular a diferença.
    # Isso elimina qualquer erro de fuso horário entre o Python e o Banco.
    cur.execute("""
        SELECT d.id, d.name, d.hostname, d.status, d.client_id, d.device_type, d.mac_address, d.serial_number,
               EXTRACT(EPOCH FROM (NOW() - d.last_seen)) as seconds_silent,
               (SELECT latency_ms FROM metrics WHERE device_id=d.id ORDER BY time DESC LIMIT 1) as last_latency,
               d.last_seen AT TIME ZONE 'UTC' as last_seen_utc
        FROM devices d
        WHERE d.last_seen IS NOT NULL
    """)
    rows = cur.fetchall()
    
    for row in rows:
        dev_id, dev_name, hostname, db_status, client_id, dtype, mac, sn, seconds_silent, last_latency, last_seen_utc = row
        
        # Se seconds_silent for None ou negativo (erro de relógio), tratamos como 0
        silent = float(seconds_silent) if seconds_silent is not None else 0
        
        is_offline = silent > OFFLINE_TIMEOUT
        
        # Log de monitoramento para o console do Railway
        if silent > 5:
            logger.info(f"[MONITOR] {dev_name} está em silêncio há {silent:.1f}s (Limite: {OFFLINE_TIMEOUT}s)")

        # Mudança de estado: ONLINE -> OFFLINE
        if is_offline and db_status != 'offline':
            logger.warning(f"🚨 QUEDA DETECTADA: {dev_name} ({silent:.1f}s sem sinal)")
            try:
                # 1. Força status offline no DB
                cur.execute("UPDATE devices SET status='offline' WHERE id=%s", (dev_id,))
                # 2. Grava o alerta
                cur.execute("INSERT INTO alerts(device_id,host,expression,value,threshold,alert_type,client_id,fired_at) VALUES(%s,%s,'offline',1,0,'offline',%s,NOW())",(dev_id,hostname or dev_name,client_id))
                # 3. Grava a métrica para o Dashboard (importante: status='offline')
                cur.execute("INSERT INTO metrics(time,host,device_id,latency_ms,status) VALUES(NOW(),%s,%s,0,'offline')", (hostname or dev_name, dev_id))
                conn.commit()
                
                # 4. Envia Notificações
                tg_tok, tg_cid, cl_email, cl_name, wa_inst, wa_tok, wa_num = get_client_config(cur, client_id)
                edev_name = escape_html(dev_name); ehostname = escape_html(hostname or dev_name)
                mac_sn_str = f"MAC: {escape_html(mac)} | SN: {escape_html(sn)}\n" if mac or sn else ""
                lat_str = f"<b>{last_latency if last_latency else 0:.1f}ms</b>"

                msg=(f"❌ <b>{edev_name}</b>\n"
                     f"Problema: Host <b>{ehostname}</b> está indisponível\n\n"
                     f"Host: {edev_name}\n"
                     f"Última Latência: {lat_str}\n"
                     f"Data do Evento: <b>{now_display()}</b>\n"
                     f"{mac_sn_str}"
                     +(f"Descrição: {escape_html(cl_name)}\n" if cl_name else "")
                     +"Indicação: Verifique a conectividade ou alimentação do dispositivo.")
                
                send_telegram(msg, tg_tok, tg_cid)
                send_whatsapp(msg.replace("<b>","*").replace("</b>","*"), wa_inst, wa_tok, wa_num)
            except Exception as e:
                logger.error(f"Erro ao processar queda de {dev_name}: {e}")
                conn.rollback()

        # Mudança de estado: OFFLINE -> ONLINE
        elif not is_offline and db_status == 'offline':
            logger.info(f"✅ RETORNO DETECTADO: {dev_name} (sinal recuperado)")
            try:
                cur.execute("UPDATE devices SET status='online' WHERE id=%s", (dev_id,))
                cur.execute("INSERT INTO metrics(time,host,device_id,latency_ms,status) VALUES(NOW(),%s,%s,%s,'online')", (hostname or dev_name, dev_id, last_latency or 0))
                conn.commit()
                
                tg_tok, tg_cid, cl_email, cl_name, wa_inst, wa_tok, wa_num = get_client_config(cur, client_id)
                edev_name = escape_html(dev_name)
                lat_str = f"<b>{last_latency if last_latency else 0:.1f}ms</b>"

                msg=(f"✅ <b>{edev_name}</b>\n"
                     f"Normalizado: Dispositivo voltou a se comunicar\n\n"
                     f"Host: {edev_name}\n"
                     f"Latência Atual: {lat_str}\n"
                     f"Data da Normalização: <b>{now_display()}</b>\n")
                
                send_telegram(msg, tg_tok, tg_cid)
                send_whatsapp(msg.replace("<b>","*").replace("</b>","*"), wa_inst, wa_tok, wa_num)
            except Exception as e:
                logger.error(f"Erro ao processar retorno de {dev_name}: {e}")
                conn.rollback()

def fire_alert(cur,conn,trigger_id,name,host,expr,value,threshold,device_id=None,client_id=None):
    if is_in_cooldown(host,expr): return
    try:
        cur.execute("INSERT INTO alerts(trigger_id,device_id,host,expression,value,threshold,alert_type,client_id) VALUES(%s,%s,%s,%s,%s,%s,'threshold',%s)",
            (trigger_id,device_id,host,expr,float(value),float(threshold),client_id))
        conn.commit()
    except Exception as e: logger.error(f"Alert save: {e}"); conn.rollback()
    set_cooldown(host,expr)
    unit=get_unit(expr)
    sev_label,sev_icon=get_severity_level(expr,value,threshold)
    meta=SEVERITY.get(expr,{"icon":"📊","label":expr})
    dtype,tags,dname,mac,sn=None,[],None,None,None
    tg_tok, tg_cid, cl_email, cl_name = get_client_config(cur, client_id)
    if device_id:
        try:
            cur.execute("SELECT device_type,tags,name,mac_address,serial_number FROM devices WHERE id=%s",(device_id,))
            row=cur.fetchone()
            if row: dtype,tags,dname,mac,sn=row[0],row[1] or [],row[2],row[3],row[4]
        except: pass
    d_icon=device_icon(dtype)
    tags_str=" ".join([f"#{t}" for t in tags]) if tags else ""
    mac_sn_str = f"MAC: {escape_html(mac)} | SN: {escape_html(sn)}\n" if mac or sn else ""
    client_suffix = f"\n🏢 Cliente: <b>{escape_html(cl_name)}</b>" if cl_name else ""
    logger.warning(f"ALERT [{sev_label}] {name} | {host} | {expr}={value:.1f}{unit}")
    
    # Escapando variáveis dinâmicas para evitar erro no Telegram HTML
    ename = escape_html(name)
    ehost = escape_html(host)
    edname = escape_html(dname or host)
    emeta_label = escape_html(meta['label'])
    esev_label = escape_html(sev_label)
    ecl_name = escape_html(cl_name)
    etags_str = escape_html(tags_str)

    msg=(f"{sev_icon} <b>{edname}</b>\n"
         f"Problema: {emeta_label} atingiu {value:.1f}{unit} (limite: {threshold}{unit})\n"
         f"Host: {ehost}\n"
         f"{mac_sn_str}"
         f"Data do Evento: {now_str()}\n"
         f"Trigger: {ename}\n"
         +(f"Descrição: {ecl_name}\n" if cl_name else "")
         +(f"Tags: {etags_str}\n" if tags_str else "")
         +f"Indicação: {esev_label} — verifique o dispositivo.")
    send_telegram(msg, tg_tok, tg_cid)
    send_email(f"[{APP_NAME}] {sev_icon} {sev_label}: {name} em {host}",
        f"ALERTA {sev_label}\n\nTrigger: {name}\nHost: {host}\nDevice: {dname or 'N/A'}\nMAC: {mac}\nSN: {sn}\nCliente: {cl_name or 'N/A'}\nMétrica: {meta['label']} = {value:.1f}{unit}\nLimite: {threshold}{unit}\nHorário: {now_str()}", cl_email)

def send_status_summary(cur):
    global last_summary_time
    if (time.time()-last_summary_time)<3600: return
    last_summary_time=time.time()
    cur.execute("SELECT COUNT(*) FROM devices WHERE status='online'")
    online=cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM devices WHERE status='offline'")
    offline=cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM clients WHERE status='active'")
    clients_count=cur.fetchone()[0]
    lines=[f"📊 <b>STATUS REPORT — {APP_NAME}</b>",f"━━━━━━━━━━━━━━━━━━━━",
           f"🏢 Clientes ativos: <b>{clients_count}</b>",
           f"🟢 Devices online: <b>{online}</b>  🔴 Offline: <b>{offline}</b>",f"━━━━━━━━━━━━━━━━━━━━",f"🕐 {now_str()}"]
    send_telegram("\n".join(lines))
    logger.info("Status summary sent")

def evaluate_triggers(cur, conn):
    cur.execute("SELECT id,name,expression,threshold,client_id FROM triggers WHERE enabled=TRUE")
    triggers=cur.fetchall()
    if not triggers: return

    # Get latest metrics with device info in one query
    cur.execute("""
        SELECT DISTINCT ON(m.host) 
            m.host, m.cpu, m.memory, m.disk_percent, m.latency_ms, m.load_avg, m.temperature, 
            m.device_id, d.client_id
        FROM metrics m
        LEFT JOIN devices d ON d.id = m.device_id
        WHERE m.time > NOW() - INTERVAL '1 minute'
        ORDER BY m.host, m.time DESC
    """)
    metrics=cur.fetchall()
    if not metrics: return

    expr_idx={"cpu":1,"memory":2,"disk_percent":3,"latency_ms":4,"load_avg":5,"temperature":6}
    for trigger_id,name,expr,threshold,trigger_client_id in triggers:
        idx=expr_idx.get(expr)
        if idx is None: continue
        
        for row in metrics:
            host,cpu,memory,disk,latency,load,temp,device_id,device_client_id=row
            
            # Filter by client_id if trigger is client-specific
            if trigger_client_id and device_client_id and trigger_client_id != device_client_id:
                continue
                
            vals=[None,cpu,memory,disk,latency,load,temp]
            value=vals[idx]
            
            if value is not None and float(value)>float(threshold):
                fire_alert(cur,conn,trigger_id,name,host,expr,value,threshold,device_id,device_client_id or trigger_client_id)

def check_new_events(cur, conn):
    """Monitora a tabela de eventos (analíticos) e envia para o Telegram"""
    global last_event_id
    
    # Na primeira execução, pega o ID do último evento para não enviar histórico antigo
    if last_event_id == 0:
        cur.execute("SELECT COALESCE(MAX(id), 0) FROM events")
        last_event_id = cur.fetchone()[0]
        return

    cur.execute("""
        SELECT e.id, e.event_type, e.channel, e.description, e.severity, e.time,
               d.name as device_name, d.client_id, d.device_type, d.mac_address, d.serial_number
        FROM events e
        JOIN devices d ON d.id = e.device_id
        WHERE e.id > %s
        ORDER BY e.id ASC
    """, (last_event_id,))
    
    events = cur.fetchall()
    for ev in events:
        eid, etype, channel, desc, sev, etime, dname, cid, dtype, mac, sn = ev
        last_event_id = eid
        
        # Prepara a mensagem de alerta analítico
        edname = escape_html(dname)
        etype_display = escape_html(etype.replace("_", " ").upper())
        edesc = escape_html(desc)
        etime_str = etime.astimezone(TIMEZONE_DISPLAY).strftime("%d/%m/%Y %H:%M:%S")
        
        # Ícone baseado na severidade ou tipo
        icon = "🎬"
        if "pessoa" in etype.lower() or "human" in etype.lower(): icon = "👤"
        elif "veiculo" in etype.lower() or "car" in etype.lower(): icon = "🚗"
        elif sev.lower() == "critical": icon = "🚨"

        tg_tok, tg_cid, cl_email, cl_name, wa_inst, wa_tok, wa_num = get_client_config(cur, cid)
        
        msg = (f"{icon} <b>ALERTA ANALÍTICO</b>\n"
               f"━━━━━━━━━━━━━━━━━━━━\n"
               f"📷 <b>{edname}</b>\n"
               f"Evento: <b>{etype_display}</b>\n"
               f"Canal: {channel}\n"
               f"Horário: {etime_str}\n"
               f"━━━━━━━━━━━━━━━━━━━━\n"
               f"📝 {edesc}\n"
               f"📍 {escape_html(cl_name or 'NexusWatch')}")
        
        send_telegram(msg, tg_tok, tg_cid)
        # Opcional: enviar para WhatsApp se for crítico
        if sev.lower() == "critical":
            send_whatsapp(msg.replace("<b>", "*").replace("</b>", "*"), wa_inst, wa_tok, wa_num)

def evaluate_once():
    with get_conn() as conn:
        cur=conn.cursor()
        check_ping_devices(cur,conn)
        check_offline_devices(cur,conn)
        check_new_events(cur,conn) # Adicionado monitoramento de eventos analíticos
        send_status_summary(cur)
        evaluate_triggers(cur,conn)

def main():
    logger.info(f"{'='*52}")
    logger.info(f"  {APP_NAME} — Multi-tenant Monitor")
    logger.info(f"  interval={EVAL_INTERVAL}s | ping_timeout={PING_TIMEOUT}s")
    logger.info(f"  offline_timeout={OFFLINE_TIMEOUT}s | cooldown={ALERT_COOLDOWN}s")
    
    # Teste de envio IMEDIATO ao iniciar para diagnosticar credenciais
    if TG_TOKEN and TG_CHAT_ID:
        logger.info(f"Enviando alerta de teste de inicialização para {TG_CHAT_ID}...")
        send_telegram(f"🔧 <b>{APP_NAME}</b>: Monitor de Alertas Reiniciado.\nVerificando conectividade... ✅")
    else:
        logger.error("ERRO: TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID não configurados!")

    logger.info(f"  telegram={'ON' if TG_TOKEN else 'OFF'} | chat_id={TG_CHAT_ID[:5]}***")
    logger.info(f"  email={'ON' if SMTP_HOST else 'OFF'}")
    logger.info(f"{'='*52}")
    send_telegram(
        f"🚀 <b>{APP_NAME} iniciado!</b>\n━━━━━━━━━━━━━━━━━━━━\n"
        f"⏱ Checagem: <b>{EVAL_INTERVAL}s</b>\n📡 Ping: <b>{PING_TIMEOUT}s timeout</b>\n"
        f"📴 Offline timeout: <b>{OFFLINE_TIMEOUT}s</b>\n🔕 Cooldown: <b>{ALERT_COOLDOWN}s</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n✅ Multi-tenant ATIVO\n✅ Ping Monitor ATIVO\n✅ SNMP Monitor ATIVO\n"
        f"━━━━━━━━━━━━━━━━━━━━\n🕐 {now_str()} #nexuswatch"
    )
    while True:
        try: evaluate_once()
        except Exception as e: logger.exception(f"Error: {e}")
        time.sleep(EVAL_INTERVAL)

if __name__ == "__main__": main()
