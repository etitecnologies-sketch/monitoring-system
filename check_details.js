const https = require('https');

const API_HOST = "monitoring-system-production-1e5a.up.railway.app";
const API_PATH = "/auth/status";

console.log("🔍 Teste de Conexão Profunda...");

const options = {
  hostname: API_HOST,
  port: 443,
  path: API_PATH,
  method: 'GET',
  headers: {
    'User-Agent': 'NodeJS/Diagnostic'
  }
};

const req = https.request(options, (res) => {
  console.log(`📡 Resposta Recebida!`);
  console.log(`   Status: ${res.statusCode}`);
  console.log(`   Headers: ${JSON.stringify(res.headers, null, 2)}`);
  
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (e) => {
  console.error(`❌ Erro Fatal: ${e.message}`);
});

req.end();
