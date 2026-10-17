import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const replay = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../results/replay_summary.json', import.meta.url)), 'utf8'));
const NSPIKES = replay.total_spikes_per_mode.toLocaleString('en-US');
// Fixed storyboard for the 20 s LinkedIn video (1080x1350, 30 fps, 0.099x playback). Pure function of time.
export const HERO_T = 9.2;       // seconds into the story used for media/hero.png (cascade fully developed, MN9 near its plateau)

const ease = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;

export function timeline(t, { feed, home }, opts = {}) {
  // stimulus script
  let stim = 'none';
  if (t >= 2.5) stim = 'sugar';
  if (t >= 11.5) stim = 'sugar+bitter';
  // captions
  let caption = '';
  if (t < 2.4) caption = `138,639 neurons<small>one fruit-fly brain, 15.1 million connections</small>`;
  else if (t < 5.6) caption = `Press SUGAR<small>21 taste neurons start firing</small>`;
  else if (t < 11.3) caption = `Activity cascades to MN9<small>the motor neuron that extends the proboscis</small>`;
  else if (t < 16.4) caption = `Add BITTER<small>inhibition reaches MN9 and silences it</small>`;
  else caption = `Same inputs, same spikes<small>${NSPIKES} spikes identical to the authors' Brian2 code</small>`;
  // camera: a slow orbit that pushes in on the feeding circuit while sugar is on, then eases back
  const push = ease((t - 2.5) / 5.5) * (1 - ease((t - 16.5) / 3.3)) * (opts.hero ? 0.62 : 1);
  const base = { x: 0.0, y: -0.35, z: 0.1 };
  const target = [lerp(base.x, feed[0], 0.55 * push), lerp(base.y, feed[1], 0.55 * push), lerp(base.z, feed[2], 0.55 * push)];
  const distance = lerp(home * 0.84, home * 0.52, push);
  const azimuth = lerp(-0.42, 0.62, t / 20) + 0.12 * Math.sin(t * 0.5);
  const polar = lerp(1.34, 1.22, push);
  return { stim, caption, speed: 0.1, camera: { target, distance, azimuth, polar } };
}
