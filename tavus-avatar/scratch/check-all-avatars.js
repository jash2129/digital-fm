const https = require('https');

const apiKey = '3273236a-3dd8-451c-b252-f3d07fad7548';

function get(url, headers = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data.substring(0, 300) });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
  });
}

async function run() {
  console.log("=== 1. Checking LiveAvatar API (api.liveavatar.com) ===");
  const la = await get('https://api.liveavatar.com/v1/avatars', { 'X-API-KEY': apiKey });
  console.log("Status:", la.status);
  console.log(JSON.stringify(la.data || la, null, 2));

  console.log("\n=== 2. Checking HeyGen v2/avatars (api.heygen.com) ===");
  const hg2 = await get('https://api.heygen.com/v2/avatars', { 'X-Api-Key': apiKey });
  console.log("Status:", hg2.status);
  console.log(JSON.stringify(hg2.data || hg2, null, 2));

  console.log("\n=== 3. Checking HeyGen v1/avatar.list ===");
  const hg1 = await get('https://api.heygen.com/v1/avatar.list', { 'X-Api-Key': apiKey });
  console.log("Status:", hg1.status);
  console.log(JSON.stringify(hg1.data || hg1, null, 2));
}

run();
