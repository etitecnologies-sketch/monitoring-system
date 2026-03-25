const https = require('https');

// Lista de todos os seus possíveis serviços no Railway para descobrir qual está vivo
const targets = [
    { name: "API (monitoring-system)", url: "https://monitoring-system-production-1e5a.up.railway.app/auth/status" },
    { name: "Frontend (powerful-unity)", url: "https://powerful-unity-production-c566.up.railway.app/" },
    { name: "Possível Frontend (courageous-charm)", url: "https://courageous-charm-production.up.railway.app/" }
];

function check(target) {
    console.log(`🔍 Testando ${target.name}...`);
    const start = Date.now();
    
    const req = https.get(target.url, (res) => {
        const duration = Date.now() - start;
        if (res.statusCode === 200) {
            console.log(`✅ ${target.name}: ONLINE (200) - ${duration}ms`);
        } else {
            console.log(`❌ ${target.name}: ERRO ${res.statusCode}`);
        }
    });

    req.on('error', (e) => {
        console.log(`❌ ${target.name}: FALHA CRÍTICA (${e.message})`);
    });

    req.end();
}

console.log("=".repeat(50));
console.log("🚀 NexusWatch Pro - Scanner de Serviços Railway");
console.log("=".repeat(50));

targets.forEach((t, i) => {
    setTimeout(() => check(t), i * 1000);
});
