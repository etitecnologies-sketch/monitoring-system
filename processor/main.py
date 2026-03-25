import os, time, logging, smtplib, requests, datetime, subprocess, html, re
from email.mime.text import MIMEText
from contextlib import contextmanager
import psycopg2
import concurrent.futures

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

APP_NAME        = "NexusWatch Pro"

def sanitize(val): return re.sub(r'["\'`\s]', '', val) if val else ""

DATABASE_URL    = sanitize(os.environ.get("DATABASE_URL", ""))
EVAL_INTERVAL   = int(os.getenv("EVAL_INTERVAL", "5"))
OFFLINE_TIMEOUT = int(os.getenv("OFFLINE_TIMEOUT", "45")) # Reduzido para 45s para alerta rápido
ALERT_COOLDOWN  = int(os.getenv("ALERT_COOLDOWN", "120"))
PING_TIMEOUT    = int(os.getenv("PING_TIMEOUT", "3"))
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
    if token and chat_id: targets.append((token, chat_id))
    if TG_TOKEN and TG_CHAT_ID: targets.append((TG_TOKEN, TG_CHAT_ID))
    if not targets: return
    for tok, cid in set(targets):
        try:
            r = requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                json={"chat_id":cid,"text":message,"parse_mode":"HTML"},timeout=10)
            if r.status_code == 200:
                logger.info(f"Telegram ✓ sent to {cid}")
            else:
                logger.error(f"Telegram error {r.status_code} for {cid}: {r.text}")
        except Exception as e:
            logger.error(f"Telegram exception: {e}")

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
    cur.execute("""SELECT id,name,ip_address,device_type,tags,status,
        snmp_community,snmp_version,monitor_snmp,hostname,client_id,ddns_address,monitor_port,
        mac_address,serial_number
        FROM devices WHERE (ip_address IS NOT NULL AND ip_address!='' AND (monitor_ping=TRUE OR monitor_port > 0))
        OR (ddns_address IS NOT NULL AND ddns_address!='' AND monitor_port > 0)""")
    devices=cur.fetchall()
    if not devices: return

    def check_one(dev):
        dev_id,dev_name,ip,dtype,tags,db_status,sc,sv,do_snmp,hostname,client_id,ddns,port,mac,sn=dev
        
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

        return dev_id,dev_name,ip or ddns,dtype,tags,db_status,sc,sv,do_snmp,hostname,client_id,alive,latency,method,mac,sn

    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as ex:
        results=list(ex.map(check_one,devices))

    for r in results:
        if r is None: continue
        dev_id,dev_name,target,dtype,tags,db_status,sc,sv,do_snmp,hostname,client_id,alive,latency,method,mac,sn=r
        d_icon=device_icon(dtype)
        tags_list=tags if tags else []
        tags_str=" ".join([f"#{t}" for t in tags_list]) if tags_list else ""
        mac_sn_str = f"MAC: {mac} | SN: {sn}\n" if mac or sn else ""
        was_down = ping_state.get(dev_id, False) or (db_status == 'offline')

        # Buscar config do cliente
        tg_tok, tg_cid, cl_email, cl_name = get_client_config(cur, client_id)

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
                        disk_total,disk_percent,net_rx_bytes,net_tx_bytes,latency_ms,uptime_seconds,load_avg,processes,temperature)
                        VALUES(NOW(),(SELECT id FROM hosts WHERE name=%s),%s,%s,0,0,0,0,0,0,0,%s,0,0,0,0)""",
                        (hl,hl,dev_id,latency))
                    conn.commit()
                except Exception as e: logger.debug(f"Ping metric: {e}"); conn.rollback()

        if alive and was_down:
            ping_state[dev_id]=False
            logger.info(f"✅ DEVICE ONLINE: {dev_name} ({target}) via {method}")
            edev_name = html.escape(dev_name)
            etarget = html.escape(target)
            ecl_name = html.escape(cl_name) if cl_name else ""
            msg=(f"✅ <b>{edev_name}</b>\n"
                 f"Normalizado: Host <b>{etarget}</b> está respondendo via {method}\n\n"
                 f"Host: {edev_name}\n"
                 f"Data da Normalização: {now_str()}\n"
                 f"Detalhes: {d_icon} {html.escape(dtype or 'other')} - {html.escape(mac or 'N/A')} - {html.escape(sn or 'N/A')}\n"
                 +(f"Descrição: {ecl_name}\n" if cl_name else "")
                 +(f"Tags: {html.escape(tags_str)}\n" if tags_str else ""))
            send_telegram(msg, tg_tok, tg_cid)
            send_email(f"[{APP_NAME}] 🟢 ONLINE: {dev_name}",
                f"Device '{dev_name}' voltou ONLINE.\nAlvo: {target}\nMétodo: {method}\nLatência: {latency:.0f}ms\nMAC: {mac}\nSN: {sn}\nCliente: {cl_name or 'N/A'}\nHorário: {now_str()}", cl_email)

        elif not alive and not was_down:
            ping_state[dev_id]=True
            logger.warning(f"🚨 DEVICE OFFLINE: {dev_name} ({target})")
            try:
                cur.execute("INSERT INTO alerts(device_id,host,expression,value,threshold,alert_type,client_id) VALUES(%s,%s,'offline',1,0,'offline',%s)",(dev_id,target or dev_name,client_id))
                cur.execute("UPDATE devices SET status='offline' WHERE id=%s",(dev_id,))
                conn.commit()
            except Exception as e: logger.error(f"Alert DB save error: {e}"); conn.rollback()
            edev_name = html.escape(dev_name)
            etarget = html.escape(target)
            ecl_name = html.escape(cl_name) if cl_name else ""
            msg=(f"❌ <b>{edev_name}</b>\n"
                 f"Problema: Host <b>{etarget}</b> está indisponível via {method}\n\n"
                 f"Host: {edev_name}\n"
                 f"Data do Evento: {now_str()}\n"
                 f"Detalhes: {d_icon} {html.escape(dtype or 'other')} - {html.escape(mac or 'N/A')} - {html.escape(sn or 'N/A')}\n"
                 +(f"Descrição: {ecl_name}\n" if cl_name else "")
                 +(f"Tags: {html.escape(tags_str)}\n" if tags_str else "")
                 +f"Indicação: Falha na conexão via {method}. Verifique o equipamento.")
            send_telegram(msg, tg_tok, tg_cid)
            send_email(f"[{APP_NAME}] 🔴 OFFLINE: {dev_name}",
                f"Device '{dev_name}' ficou OFFLINE.\nAlvo: {target}\nMAC: {mac}\nSN: {sn}\nCliente: {cl_name or 'N/A'}\nHorário: {now_str()}", cl_email)

def check_offline_devices(cur, conn):
    # Monitora todos os dispositivos que têm sinal de vida (last_seen), independente do flag monitor_agent
    # Isso garante que câmeras Push/TCP sejam alertadas mesmo que o usuário esqueça o flag de agente
    cur.execute("SELECT id,name,hostname,last_seen,status,device_type,tags,client_id,mac_address,serial_number,monitor_agent FROM devices")
    rows = cur.fetchall()
    logger.info(f"Monitorando status offline para {len(rows)} dispositivos...")
    
    for row in rows:
        dev_id,dev_name,hostname,last_seen,status,dtype,tags,client_id,mac,sn,agent_enabled=row
        if last_seen is None:
            # logger.info(f"Skip {dev_name}: no last_seen")
            continue
        
        now=datetime.datetime.now(datetime.timezone.utc)
        if last_seen and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=datetime.timezone.utc)
        
        diff = (now-last_seen).total_seconds()
        is_offline = diff > OFFLINE_TIMEOUT
        was_offline = device_online_state.get(dev_id, False) or (status == 'offline')

        # Diagnóstico profundo para o usuário
        if diff > 10:
            logger.info(f"DEBUG OFFLINE: {dev_name} | Status Atual: {status} | Segundos sem sinal: {diff:.0f}s | Threshold: {OFFLINE_TIMEOUT}s | Is Offline: {is_offline}")
        
        if diff < -60: # Sinal vindo do futuro? (Erro de relógio)
            logger.error(f"ERRO DE RELÓGIO: {dev_name} tem last_seen no futuro! {last_seen} vs {now}")
            # Força o last_seen para agora para corrigir o cálculo no próximo ciclo
            try:
                with get_conn() as conn2:
                    with conn2.cursor() as cur2:
                        cur2.execute("UPDATE devices SET last_seen=NOW() WHERE id=%s", (dev_id,))
                        conn2.commit()
            except: pass

        # Se o monitoramento de agente/push estiver desativado e o dispositivo estiver online, pulamos
        if not agent_enabled and not is_offline:
            continue

        # Log de diagnóstico no Railway console
        if diff > 15: # Reduzido log para 15s para depurar melhor
            logger.info(f"Monitorando queda: {dev_name} ({dev_id}) sem sinal há {diff:.0f}s (Threshold: {OFFLINE_TIMEOUT}s)")
        
        d_icon=device_icon(dtype)
        tags_list=tags if tags else []
        tags_str=" ".join([f"#{t}" for t in tags_list]) if tags_list else ""
        
        # Escapando HTML para evitar erros no Telegram
        edev_name = html.escape(dev_name)
        ehostname = html.escape(hostname or dev_name)
        
        mac_sn_str = f"Detalhes do Equipamento: {html.escape(dtype or 'other')} - {html.escape(mac or 'N/A')} - {html.escape(sn or 'N/A')}\n" if mac or sn else ""
        tg_tok, tg_cid, cl_email, cl_name, wa_inst, wa_tok, wa_num = get_client_config(cur, client_id)
        ecl_name = html.escape(cl_name) if cl_name else ""

        if is_offline and not was_offline:
            device_online_state[dev_id]=True
            try:
                cur.execute("INSERT INTO alerts(device_id,host,expression,value,threshold,alert_type,client_id) VALUES(%s,%s,'offline',1,0,'offline',%s)",(dev_id,hostname or dev_name,client_id))
                conn.commit()
            except Exception as e: logger.error(f"Offline alert DB save error: {e}"); conn.rollback()
            
            logger.warning(f"🚨 OFFLINE DETECTADO: {dev_name} ({diff:.0f}s)")
            msg=(f"❌ <b>{edev_name}</b>\n"
                 f"Problema: Host <b>{ehostname}</b> está indisponível\n\n"
                 f"Host: {edev_name}\n"
                 f"Data do Evento: {now_str()}\n"
                 f"{mac_sn_str}"
                 +(f"Descrição: {ecl_name}\n" if cl_name else "")
                 +(f"Tags: {html.escape(tags_str)}\n" if tags_str else "")
                 +"Indicação: Verifique a conectividade do dispositivo.")
            send_telegram(msg, tg_tok, tg_cid)
            send_whatsapp(msg.replace("<b>","*").replace("</b>","*"), wa_inst, wa_tok, wa_num)
            send_email(f"[{APP_NAME}] 🔴 OFFLINE: {dev_name}",
                f"Device '{dev_name}' parou de enviar dados.\nCliente: {cl_name or 'N/A'}\nHost: {hostname}\nMAC: {mac}\nSN: {sn}\nÚltimo contato: {last_seen}\nHorário: {now_str()}", cl_email)

        elif not is_offline and was_offline:
            device_online_state[dev_id]=False
            logger.info(f"✅ ONLINE RECUPERADO: {dev_name}")
            msg=(f"✅ <b>{edev_name}</b>\n"
                 f"Normalizado: Dispositivo voltou a se comunicar\n\n"
                 f"Host: {edev_name}\n"
                 f"Data da Normalização: {now_str()}\n"
                 f"{mac_sn_str}"
                 +(f"Descrição: {ecl_name}\n" if cl_name else "")
                 +(f"Tags: {html.escape(tags_str)}\n" if tags_str else ""))
            send_telegram(msg, tg_tok, tg_cid)
            send_whatsapp(msg.replace("<b>","*").replace("</b>","*"), wa_inst, wa_tok, wa_num)
            send_email(f"[{APP_NAME}] 🟢 ONLINE: {dev_name}",
                f"Device '{dev_name}' voltou.\nCliente: {cl_name or 'N/A'}\nMAC: {mac}\nSN: {sn}\nHorário: {now_str()}", cl_email)

        new_status="offline" if is_offline else "online"
        if new_status!=status:
            try: cur.execute("UPDATE devices SET status=%s WHERE id=%s",(new_status,dev_id)); conn.commit()
            except: conn.rollback()

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
    mac_sn_str = f"MAC: {mac} | SN: {sn}\n" if mac or sn else ""
    client_suffix = f"\n🏢 Cliente: <b>{cl_name}</b>" if cl_name else ""
    logger.warning(f"ALERT [{sev_label}] {name} | {host} | {expr}={value:.1f}{unit}")
    msg=(f"{sev_icon} {dname or host}\n"
         f"Problema: {meta['label']} atingiu {value:.1f}{unit} (limite: {threshold}{unit})\n"
         f"Host: {host}\n"
         f"{mac_sn_str}"
         f"Data do Evento: {now_str()}\n"
         f"Trigger: {name}\n"
         +(f"Descrição: {cl_name}\n" if cl_name else "")
         +(f"Tags: {tags_str}\n" if tags_str else "")
         +f"Indicação: {sev_label} — verifique o dispositivo.")
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

def evaluate_once():
    with get_conn() as conn:
        cur=conn.cursor()
        check_ping_devices(cur,conn)
        check_offline_devices(cur,conn)
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
