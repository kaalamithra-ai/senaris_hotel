// Minimal Chrome DevTools Protocol harness (no npm deps, Node 22 native WebSocket).
// Launches the cached Chromium, evaluates JS in the page and reports console errors.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CHROME = path.join(
  os.homedir(),
  'AppData', 'Local', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe'
);
const PORT = 9333;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitForChrome() {
  for (let i = 0; i < 60; i++) {
    try { return await getJSON('/json/version'); } catch (e) { await sleep(500); }
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
      } else if (msg.method) {
        c.events.push(msg);
      }
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

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-dev-shm-usage', '--hide-scrollbars', '--allow-file-access-from-files',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForChrome();
    const targets = await getJSON('/json/list');
    const page = targets.find(t => t.type === 'page');
    const c = await CDP.connect(page.webSocketDebuggerUrl);

    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.send('Page.enable');
    await c.send('Network.enable');

    const target = process.argv[2] || 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
    await c.send('Page.navigate', { url: target });

    // Wait until the document is fully parsed (Tailwind CDN blocks the parser).
    let ready = '';
    for (let i = 0; i < 40; i++) {
      ready = await c.evalExpr('document.readyState');
      if (ready === 'complete') break;
      await sleep(1000);
    }
    console.log('READYSTATE:', ready);
    await sleep(2000);

    const failed = c.events
      .filter(e => e.method === 'Network.loadingFailed')
      .map(e => 'FAILED: ' + e.params.errorText + ' ' + (e.params.type || ''));
    const reqs = c.events
      .filter(e => e.method === 'Network.requestWillBeSent')
      .map(e => e.params.request.url);
    console.log('=== REQUESTS ===');
    console.log(reqs.join('\n'));
    console.log('=== FAILED REQUESTS ===');
    console.log(failed.length ? failed.join('\n') : '(none)');

    // Collect console errors / page exceptions
    const errors = c.events
      .filter(e => e.method === 'Runtime.exceptionThrown' ||
                   (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
                   (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
      .map(e => {
        if (e.method === 'Runtime.exceptionThrown') {
          return 'EXCEPTION: ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
        }
        if (e.method === 'Log.entryAdded') return 'LOG[' + e.params.entry.source + ']: ' + e.params.entry.text;
        return 'CONSOLE: ' + e.params.args.map(a => a.value ?? a.description).join(' ');
      });

    console.log('=== CONSOLE ERRORS ===');
    console.log(errors.length ? errors.join('\n') : '(none)');

    const diag = await c.evalExpr(`JSON.stringify({href: location.href, title: document.title, hasMenu: !!document.querySelector('#menuGrid'), scripts: document.scripts.length})`);
    console.log('DIAG:', diag);

    const report = await c.evalExpr(`(() => {
      const q = s => document.querySelector(s);
      return JSON.stringify({
        title: document.title,
        menuCards: document.querySelectorAll('article.menu-card').length,
        menuCount: q('#menuCount')?.textContent,
        menuCartCount: q('#menuCartCount')?.textContent,
        cartBadge: q('#cartBadge')?.textContent,
        floatCount: q('#floatCount')?.textContent,
        floatTotal: q('#floatTotal')?.textContent,
        search: q('#menuSearch')?.value,
        vegOnly: q('#vegOnly')?.checked,
        sort: q('#menuSort')?.value,
        cart: cart,
        cartCount: cartCount(),
        MENUlen: MENU.length,
        activeTab: [...document.querySelectorAll('.menu-tab')].filter(b=>b.classList.contains('active')).map(b=>b.dataset.filter),
        barCheckIn: q('#barCheckIn')?.value,
        barCheckOut: q('#barCheckOut')?.value,
        bkIn: q('#bkIn')?.value,
        bkOut: q('#bkOut')?.value,
        bkSummary: q('#bkSummaryLine')?.textContent,
        bkBase: q('#bkBase')?.textContent,
        bkTax: q('#bkTax')?.textContent,
        bkTotal: q('#bkTotal')?.textContent,
        testiDots: document.querySelectorAll('#testiDots button').length,
        roomItems: document.querySelectorAll('.room-item').length,
        faqBtns: document.querySelectorAll('.faq-btn').length,
        imgsBroken: [...document.images].filter(i=>i.complete && i.naturalWidth===0).map(i=>i.src),
        imgsTotal: document.images.length,
      }, null, 1);
    })()`);
    console.log('\n=== STATE ===');
    console.log(report);
    await sleep(500);
  } catch (e) {
    console.error('HARNESS ERROR:', e.message);
  } finally {
    chrome.kill();
  }
})();
