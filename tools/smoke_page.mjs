// End-to-end smoke test of the live page in headless Edge (real clock, no capture mode): it loads, the connectome
// streams in, Sugar drives MN9, Sugar + Bitter silences it, and the phone layout has no horizontal scroll.
// Writes results/page_smoke.json (+ media/phone-375.png).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gz': 'application/gzip' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = path.join(root, 'site', decodeURIComponent(u.pathname)); if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith(path.join(root, 'site')) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream', 'content-length': fs.statSync(p).size }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const out = { checks: {}, errors: [] };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function run(w, h, label, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on('pageerror', e => out.errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) out.errors.push(`${label}: ${m.text()}`); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html?speed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('done'), { timeout: 120000 });
  const loadMs = Date.now() - t0;
  await fn(page, loadMs);
  await page.close();
}
const read = (page, sel) => page.$eval(sel, el => el.textContent.trim());
await run(1440, 900, 'desktop', async (page, loadMs) => {
  out.checks.load_to_ready_ms = loadMs;
  out.checks.webgl_canvas = await page.$eval('#gl', c => !!(c.getContext && c.width > 0));
  await page.click('[data-stim="sugar"]');
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); })(); }));
  out.checks.headless_fps_during_cascade = +fps.toFixed(1);
  await sleep(5000);
  out.checks.sugar_after_8s = { mn9_hz: +(await read(page, '#mn9Rate')).replace(/,/g, ''), sim_time: await read(page, '#sTime'), spikes_per_s: await read(page, '#sSpk'), firing: await read(page, '#sAct'), engine: await read(page, '#sRtf'), ref: await read(page, '#refNote') };
  await page.click('[data-stim="sugar+bitter"]');
  await sleep(7000);
  out.checks.sugar_plus_bitter_after_7s = { mn9_hz: +(await read(page, '#mn9Rate')).replace(/,/g, ''), ref: await read(page, '#refNote') };
  await page.click('[data-stim="none"]');
  await page.keyboard.press('i'); await sleep(700);
  out.checks.drawer_table_rows = await page.$$eval('#valBody tr', r => r.length);
  out.checks.drawer_open = await page.$eval('#drawer', d => d.classList.contains('open'));
});
await run(375, 812, 'phone', async (page) => {
  await page.click('[data-stim="sugar"]'); await sleep(4500);
  out.checks.phone_no_horizontal_scroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
  out.checks.phone_mn9_hz = +(await read(page, '#mn9Rate')).replace(/,/g, '');
  fs.mkdirSync(path.join(root, 'media'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'media/phone-375.png') });
});
out.pass = out.errors.length === 0 && out.checks.phone_no_horizontal_scroll === true && out.checks.drawer_open === true;
fs.writeFileSync(path.join(root, 'results/page_smoke.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
