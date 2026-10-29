// Shared CDP helper: launches cached Chromium over the DevTools Protocol.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CHROME = path.join(
  os.homedir(),
  'AppData', 'Local', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe'
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitForChrome(port) {
  for (let i = 0; i < 60; i++) {
    try { return await getJSON(port, '/json/version'); } catch (e) { await sleep(500); }
  }
  throw new Error('Chrome did not start');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) c.events.push(msg);
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evalExpr(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function launch(port, width = 1440, height = 1000) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-dev-shm-usage', '--hide-scrollbars', '--allow-file-access-from-files',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForChrome(port);
  // Chrome can report zero page targets for a moment after startup, so poll until one exists.
  let page;
  for (let i = 0; i < 40; i++) {
    const targets = await getJSON(port, '/json/list');
    page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) break;
    await sleep(250);
  }
  if (!page) throw new Error('No page target available from Chrome');
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await c.send('Network.enable');
  return { chrome, c };
}

async function gotoPage(c, url) {
  await c.send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) {
    if (await c.evalExpr('document.readyState') === 'complete') break;
    await sleep(1000);
  }
  await sleep(2000);
}

module.exports = { CHROME, sleep, getJSON, waitForChrome, CDP, launch, gotoPage };
