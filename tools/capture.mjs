// Deterministic capture of the page for LinkedIn media.  ?capture=1 puts the page in a mode where the simulation is
// stepped by the script (a fixed number of 0.1 ms steps per frame), the camera and stimulus follow a fixed timeline,
// and nothing depends on the wall clock.  Frames are written as JPEG/PNG and encoded with ffmpeg.
//
//   node tools/capture.mjs --out media/flybrain-1080x1350.mp4 --w 1080 --h 1350 --seconds 20 --fps 30 --frames-dir <dir>
//   node tools/capture.mjs --hero media/hero.png --w 1080 --h 1350 --dpr 2          (single still at the hero moment)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { timeline, HERO_T } from './capture_timeline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const W = +(args.w ?? 1080), H = +(args.h ?? 1350), FPS = +(args.fps ?? 30), SECONDS = +(args.seconds ?? 20), DPR = +(args.dpr ?? 1);
const STEPS_PER_FRAME = +(args.steps ?? 33);                 // 3.3 ms of fly time per 1/30 s frame = 0.099x playback
const framesDir = args['frames-dir'] ?? path.join(root, 'tmp/frames');
const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

// tiny static server for site/ (with the right types for .gz/.json/.js/.wasm)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gz': 'application/gzip', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = path.join(root, 'site', decodeURIComponent(u.pathname)); if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith(path.join(root, 'site')) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream', 'content-length': fs.statSync(p).size }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
         `--window-size=${W},${H}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.type(), m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?capture=1&dpr=${DPR}&seed=1${args.pos ? '&pos=' + args.pos : ''}`, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
console.log('waiting for the connectome to load in the page...');
await page.waitForFunction(() => window.__capture, { timeout: 60000 });
await page.evaluate(() => window.__capture.ready);
const info = await page.evaluate(() => ({ feed: window.__capture.feedingCentroid(), home: window.__capture.homeDist() }));
console.log('ready; feeding centroid', info.feed.map(x => x.toFixed(2)).join(','), 'home distance', info.home.toFixed(1));

async function stepFrame(i, { render, snap }) {
  const t = i / FPS;
  const tl = timeline(t, { feed: info.feed, home: info.home, w: W, h: H }, { hero: !!args.hero });
  await page.evaluate(async (tl, steps, doRender, timeSec, snap) => {
    const c = window.__capture;
    if (tl.stim !== c.state.stim) c.setStim(tl.stim);
    c.setCaption(tl.caption);
    c.setCamera(tl.camera);
    await c.advance(steps);
    if (doRender) { c.render(timeSec, snap); }
  }, tl, STEPS_PER_FRAME, render, t, !!snap);
  if (render) await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

if (args.hero) {
  const target = Math.round((args.herot ? +args.herot : HERO_T) * FPS);
  for (let i = 0; i < target - 14; i++) await stepFrame(i, { render: false });
  for (let i = target - 14; i < target; i++) await stepFrame(i, { render: true });   // let the smoothed readouts settle
  await stepFrame(target, { render: true, snap: true });
  fs.mkdirSync(path.dirname(path.join(root, args.hero)), { recursive: true });
  await page.screenshot({ path: path.join(root, args.hero), type: 'png' });
  console.log('hero ->', args.hero, 'sim time', (await page.evaluate(() => window.__capture.simTime())).toFixed(1), 'ms', 'MN9', JSON.stringify(await page.evaluate(() => window.__capture.mn9())));
} else {
  fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir, { recursive: true });
  const N = Math.round(SECONDS * FPS);
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await stepFrame(i, { render: true });
    await page.screenshot({ path: path.join(framesDir, `f_${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 95 });
    if (i % 30 === 0) console.log(`frame ${i}/${N}  (${((Date.now() - t0) / 1000).toFixed(0)} s)  MN9 ${JSON.stringify(await page.evaluate(() => window.__capture.mn9()))}`);
  }
  const out = path.join(root, args.out ?? 'media/flybrain-1080x1350.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(framesDir, 'f_%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '14M', '-bufsize', '28M',
    '-vf', `scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p`, '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-an', out], { stdio: 'inherit' });
  console.log('ffmpeg exit', r.status, '->', out);
}
await browser.close(); server.close();
