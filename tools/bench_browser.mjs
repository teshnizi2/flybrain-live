// Throughput of the engine inside the real page (module worker + WebGL on the main thread) in headless Edge.
// Plays at 4x real time, which is more than the engine sustains, so the achieved simulated-seconds-per-wall-second
// is the engine's speed in the browser under whatever else is running. Writes results/browser_speed.json.
import fs from 'node:fs';
import os from 'node:os';
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
const out = { machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, loadavg_at_start: os.loadavg() }, playback_requested: 4, runs: {} };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (const stim of ['sugar', 'water', 'sugar%2Bbitter']) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/index.html?stim=${stim}&speed=4`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('done'), { timeout: 120000 });
  await sleep(2500);                                                     // warm-up (JIT) before measuring
  const simAt = async () => parseFloat((await page.$eval('#sTime', e => e.textContent)).replace(/,/g, ''));
  const t0 = performance.now(), s0 = await simAt(); const readouts = [];
  for (let i = 0; i < 15; i++) { await sleep(1000); readouts.push(await page.$eval('#sRtf', e => e.textContent.trim())); }
  const wall = (performance.now() - t0) / 1000, sim = (await simAt()) - s0;
  const rtfs = readouts.map(r => parseFloat(r)).filter(x => x > 0).sort((a, b) => a - b);
  out.runs[decodeURIComponent(stim)] = { wall_seconds: +wall.toFixed(1), simulated_seconds: +sim.toFixed(2), achieved_x_real_time: +(sim / wall).toFixed(2),
    engine_readout_median: rtfs.length ? rtfs[Math.floor(rtfs.length / 2)] : null, engine_readout_max: rtfs.length ? rtfs[rtfs.length - 1] : null };
  console.log(decodeURIComponent(stim), JSON.stringify(out.runs[decodeURIComponent(stim)]));
  await page.close();
}
out.loadavg_at_end = os.loadavg();
fs.writeFileSync(path.join(root, 'results/browser_speed.json'), JSON.stringify(out, null, 1));
console.log('load average', out.machine.loadavg_at_start.map(x => x.toFixed(1)).join(' '), '->', out.loadavg_at_end.map(x => x.toFixed(1)).join(' '));
await browser.close(); server.close();
