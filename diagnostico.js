const https = require('https');

const API_URL = "https://monitoring-system-production-1e5a.up.railway.app/auth/status";
const FRONTEND_URL = "https://powerful-unity-production-c566.up.railway.app/";

function check(name, url) {
    console.log(`🔍 Verificando ${name}: ${url}`);
    const start = Date.now();
    
    https.get(url, (res) => {
        const duration = Date.now() - start;
        if (res.statusCode === 200) {
            console.log(`✅ ${name} está ONLINE! (Status: 200, Latência: ${duration}ms)`);
        } else if (res.statusCode === 502) {
            console.log(`❌ ${name} retornou 502 Bad Gateway. (O serviço no Railway provavelmente está travado ou reiniciando)`);
        } else {
            console.log(`⚠️ ${name} retornou Status ${res.statusCode}.`);
        }
    }).on('error', (e) => {
        console.log(`❌ Erro em ${name}: ${e.message}`);
        console.log(`   DICA: Verifique se o link está correto e se o serviço está rodando no Railway.`);
    });
}

console.log("=".repeat(50));
console.log("🚀 NexusWatch Pro - Diagnóstico Rápido (Node.js)");
console.log("=".repeat(50));

check("Ingest API (Backend)", API_URL);
setTimeout(() => check("Dashboard (Frontend)", FRONTEND_URL), 1000);
