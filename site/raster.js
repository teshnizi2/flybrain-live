// Spike raster of the ~100 most active neurons (excluding the neurons we drive), rows sorted by the latency of their
// first spike after the stimulus changed, so a cascade shows up as a diagonal wave. MN9 is pinned at the bottom.
export class Raster {
  constructor(canvas, { windowMs = 400, nRows = 100, signOf }) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.windowMs = windowMs; this.nRows = nRows; this.signOf = signOf;
    this.cap = 80000; this.t = new Float32Array(this.cap); this.id = new Int32Array(this.cap); this.head = 0; this.len = 0;
    this.rows = []; this.pinned = []; this.excluded = new Set(); this.onset = 0; this.lastRank = -1e9; this.dirty = true;
    this.resize();
  }
  resize() {
    const r = this.cv.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.dpr = dpr;
  }
  setPinned(p) { this.pinned = p; }
  setExcluded(set) { this.excluded = set; }
  setOnset(ms) { this.onset = ms; this.lastRank = -1e9; }
  clear() { this.head = 0; this.len = 0; this.rows = []; this.lastRank = -1e9; }
  push(ids, times) {
    for (let k = 0; k < ids.length; k++) {
      this.t[this.head] = times[k]; this.id[this.head] = ids[k];
      this.head = (this.head + 1) % this.cap; if (this.len < this.cap) this.len++;
    }
  }
  *recent(sinceMs) {                       // newest -> oldest
    for (let q = 0, i = this.head; q < this.len; q++) {
      i = (i - 1 + this.cap) % this.cap;
      if (this.t[i] < sinceMs) return;
      yield i;
    }
  }
  rank(now) {
    const counts = new Map(), first = new Map();
    for (const i of this.recent(now - 1000)) {
      const id = this.id[i];
      if (this.excluded.has(id)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
      if (this.t[i] >= this.onset) { const f = first.get(id); if (f === undefined || this.t[i] < f) first.set(id, this.t[i]); }
    }
    const pin = new Set(this.pinned.map(p => p.id));
    const top = [...counts.entries()].filter(([id]) => !pin.has(id)).sort((a, b) => b[1] - a[1]).slice(0, this.nRows).map(([id]) => id);
    top.sort((a, b) => (first.get(a) ?? 1e12) - (first.get(b) ?? 1e12));
    this.rows = top;
  }
  update(now) {
    const r = this.cv.getBoundingClientRect();
    if (Math.abs(r.width * this.dpr - this.cv.width) > 2 || Math.abs(r.height * this.dpr - this.cv.height) > 2) this.resize();
    if (now - this.lastRank > 450) { this.lastRank = now; this.rank(now); }
    this.draw(now);
  }
  draw(now) {
    const { ctx, cv, dpr } = this; const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const nPin = this.pinned.length, total = this.nRows + nPin + 1;
    const rowH = H / total, x0 = 0, x1 = W;
    const t0 = now - this.windowMs, sx = (x1 - x0) / this.windowMs;
    // time grid every 100 ms
    ctx.strokeStyle = 'rgba(46,58,82,.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = Math.ceil(t0 / 100) * 100; g < now; g += 100) { const x = Math.round(x0 + (g - t0) * sx) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
    // separator above pinned rows
    const ySep = this.nRows * rowH + rowH * .5;
    ctx.strokeStyle = 'rgba(136,147,171,.35)'; ctx.beginPath(); ctx.moveTo(0, ySep); ctx.lineTo(W, ySep); ctx.stroke();
    const rowOf = new Map();
    this.rows.forEach((id, r) => rowOf.set(id, { y: r * rowH, pinned: false }));
    this.pinned.forEach((p, k) => rowOf.set(p.id, { y: (this.nRows + 1 + k) * rowH, pinned: true, color: p.color }));
    const tw = Math.max(1.2 * dpr, 1.6), th = Math.max(rowH - 1, 1.2);
    for (const i of this.recent(t0)) {
      const row = rowOf.get(this.id[i]); if (!row) continue;
      const x = x0 + (this.t[i] - t0) * sx;
      if (row.pinned) ctx.fillStyle = row.color;
      else ctx.fillStyle = this.signOf(this.id[i]) === 2 ? '#8ea2ff' : '#ffb43a';
      ctx.fillRect(x, row.y + .5, row.pinned ? tw * 1.5 : tw, row.pinned ? Math.max(th, 3 * dpr) : th);
    }
    // labels for pinned rows
    ctx.font = `${Math.round(9 * dpr)}px "JetBrains Mono", monospace`; ctx.textBaseline = 'middle';
    this.pinned.forEach((p, k) => { ctx.fillStyle = 'rgba(232,236,245,.85)'; ctx.fillText(p.label, 4 * dpr, (this.nRows + 1 + k) * rowH + rowH * .5 - 0 + 0.5); });
    if (!this.rows.length) {
      ctx.fillStyle = 'rgba(136,147,171,.55)'; ctx.font = `${Math.round(10 * dpr)}px "JetBrains Mono", monospace`; ctx.textAlign = 'center';
      ctx.fillText('press a taste to start a cascade', W / 2, H * .45); ctx.textAlign = 'start';
    }
    // right-edge "now" fade
    const grd = ctx.createLinearGradient(W - 14 * dpr, 0, W, 0); grd.addColorStop(0, 'rgba(21,26,35,0)'); grd.addColorStop(1, 'rgba(245,158,11,.35)');
    ctx.fillStyle = grd; ctx.fillRect(W - 14 * dpr, 0, 14 * dpr, H);
  }
}
