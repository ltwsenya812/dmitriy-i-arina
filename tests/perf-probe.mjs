// Замер плавности приглашения: node tests/perf-probe.mjs [путь к папке сайта]
// Открывает сайт в Chromium как телефон с замедленным в 4 раза процессором,
// открывает конверт, листает до конца и считает кадры и длинные задачи.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.js': 'text/javascript' };
const server = http.createServer((q, r) => {
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(b); } });
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.route(/supabase\.co/, r => r.fulfill({ status: 200, body: '{"ok":true}' }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: +(process.env.RATE || 4) });

await page.addInitScript(() => {
  window.__frames = []; window.__long = [];
  let last = performance.now();
  const tick = t => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: true });
});
await page.goto(base);
await page.waitForTimeout(1500);

async function measure(label, fn) {
  await page.evaluate(() => { window.__frames = []; window.__long = []; });
  await fn();
  const r = await page.evaluate(() => {
    const f = window.__frames.slice(1);
    const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
    return { frames: f.length, fps: +(1000 / avg).toFixed(1), janky: +(100 * f.filter(x => x > 50).length / Math.max(1, f.length)).toFixed(1), worst: Math.round(Math.max(0, ...f)), longTasks: window.__long.length, longMs: Math.round(window.__long.reduce((a, b) => a + b, 0)) };
  });
  console.log(label.padEnd(26), JSON.stringify(r));
  return r;
}

const out = {};
out.idleCover = await measure('конверт (простой)', () => page.waitForTimeout(3000));
out.open = await measure('открытие конверта', async () => { await page.click('#seal'); await page.waitForTimeout(3500); });
out.idleCastle = await measure('замок (простой)', () => page.waitForTimeout(3000));
out.scroll = await measure('прокрутка до конца', async () => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 120) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
  await page.waitForTimeout(1000);
});
out.idleEnd = await measure('финал (простой)', () => page.waitForTimeout(3000));
console.log(JSON.stringify(out));
await browser.close(); server.close();
