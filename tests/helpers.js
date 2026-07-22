'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// 啟動一個獨立的伺服器實例（JSON 檔案儲存在暫存目錄），回傳 { port, url, stop }
async function startServer(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DATABASE_URL: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));

  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url + '/api/config');
      if (res.ok) break;
    } catch {
      /* 還沒起來 */
    }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 49) throw new Error('伺服器啟動逾時：\n' + output);
  }
  return {
    port,
    url,
    dataDir,
    logs: () => output,
    stop: () => {
      child.kill();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// 與 server.js 相同演算法簽出合法 session cookie（測試多人模式用）
function signSession(user, secret) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 86400_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + sig;
}

module.exports = { startServer, signSession };
