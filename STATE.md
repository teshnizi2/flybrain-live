# flybrain-live: STATE

Handoff note. Update after every step. Last updated: 2026-10-17 14:50 (session 1, resumed after a process crash).

## Goal
Whole adult fruit-fly brain (FlyWire v783, 138,639 neurons, 15.09 M connections) simulated live in a
browser tab with the Shiu et al. 2024 (Nature 634:210) LIF model, drawn at real 3D neuron positions,
validated against the paper's own Brian2 code. See BRIEF.md and ../visual-series-RULES.md (local only:
no ALICE, no publishing, no push; commits have no attribution lines).

## Decisions so far
- Reference = the authors' own `model.py` run unmodified under Brian2 (cython target works on this M4:
  ~5 s per 1 s trial, 2 GB RSS, 18 s to build). So no NumPy/Numba clone is needed for the protocol.
- Brian2 here is 2.10.1 (paper used 2.5.1). The generated update code was read; mirrored in
  `site/engine/lif.js`: schedule per step = state update -> threshold -> synapses (delayed spikes, then
  Poisson/events) -> reset; delay 18 steps; refractory 22 steps = `timestep(2.2 ms)`; inputs (synaptic AND
  Poisson) are DROPPED while the target is refractory (Brian2 guards `g += w` and the Poisson `v += ...`
  with `not_refractory`); a neuron that spiked is refractory for the rest of that step; a Poisson event
  adds 68.75 mV to v (rfc = 0 for those neurons), so an event on the step right after a spike is lost and
  the GRN rate is r*(1 - r*dt); the reset wipes input that arrived in the spike step; `w = 0` in
  model.py's reset string is a no-op (no such neuron variable). Resting neurons are an exact fixed
  point of the float64 update (Sterbenz), so the active-set optimisation is exact.
- v-trace differs from Brian2 by <= 150 ulp (1e-15 V) because Brian2's compiled C rounds the v update
  differently (not plain IEEE; FMA/fast-math in the arm64 build; not reproduced by simple variants);
  g is bit-exact; spikes identical in every test.
- The notebooks use FlyWire **v630** IDs. 3 IDs vanished in v783 (1 sugar GRN, 1 bitter GRN, the
  ipsilateral MN9). Matched by synaptic-partner cosine similarity (1.0, 1.0, 0.99998;
  `tools/map_v630_ids.py`, `results/id_mapping_630_to_783.json`).
- Sides: the v783 annotation labels the paper's "right" sugar GRNs `side=left` (nerve-entry side) and
  MN9 `720575940660219265` (paper: "left", contralateral to the sugar set) `side=right`. UI avoids
  left/right and says contralateral / ipsilateral to the stimulated GRNs.
- The paper's "water" list has 7 of 18 neurons that the v783 annotation calls sugar GRNs (LB3c); the
  paper's "sugar" list includes high-salt (LB3d) and LB4b neurons. We reproduce the paper's lists as given.
- Orientation from the data: low z = anterior, high y = ventral, annotation left = small x.
  Voxels are 4x4x40 nm; brain spans ~815 x 390 x 278 um. Display frame = view onto the fly's face
  (view = -(x-cx), -(y-cy), -(z-cz)).
- Graph: sign constant per presynaptic neuron (96,672 exc, 41,333 inh; agrees 95.6% with the v783 top-NT
  annotation), no duplicate/self edges; 54.5 M synapses in 15.09 M edges. FULL graph packed (FBG1):
  42.4 MB raw, **30.7 MB gzip -9**, 26.2 MB brotli -q11 (< 45 MB, so full graph is the default); lite graph
  (edges with >= 2 synapses; 7.6 M edges, 86% of synapses): 17.1 MB gzip. neurons.bin 2.0 MB gzip.
  Decode in Node: gunzip 250 ms + decode 241 ms; typed arrays 91 MB.
- Product stimulus defaults (all have Brian2 refs, 30 trials): Sugar 100 Hz (paper's calibration), Water 200 Hz,
  Bitter 200 Hz, Sugar+Bitter = 100 + 200 Hz.

## Environment
- `.venv` (uv, Python 3.12; pins in requirements.txt): brian2 2.10.1, numpy, pandas, pyarrow, scipy, numba.
  Node v22 (`npm test` = `node --test tests/*.test.mjs`).
- `tools/fetch_data.sh` downloads inputs into `data/raw/` (gitignored). `python tools/prepare_data.py`
  rebuilds site/data (6 min, mostly brotli sizing). `tools/pack_graph.py 630 tmp/graph_630.fbg.gz` for v630.
- Throwaway files: session scratchpad `.../scratchpad/flybrain/` (not needed to resume).

## Done
1. Data downloaded; ID mapping.
2. Brian2 reference runs (`reference/run_brian2.py`): 17 v783 conditions + 4 v630, 30 trials x 1 s each,
   `results/reference/brian2_<graph>_<cond>.json`. v783 MN9 contra Hz: sugar10 0 | 25 0.0 | 50 18.1 |
   100 68.7+-4.8 (30/30 trials) | 150 84.3 | 200 93.3 | water100 0 | 150 6.1 | 200 30.3 | 260 53.1 |
   bitter100/200 0 | sugar100+bitter50 36.8 | +100 4.6 | +200 0.1 | sugar100+Ir94e100 16.5 |
   sugar100+water100 86.3 (synergy). 403 neurons respond at sugar 100 Hz.
   Brian2 (ours, v630) vs the authors' SHIPPED outputs: MN9 contra 92.8 vs 93.3 Hz (200 Hz, z -0.4) and
   69.6 vs 67.0 (100 Hz, z 1.8); per-neuron rate r = 1.000 / 0.999 (`reference/compare_authors_v630.py`).
3. JS engine (`site/engine/{lif,graph,prng}.js`), test-first. `npm test`: oracle fixtures (4 random nets
   from Brian2, spikes identical), constants, PRNG, graph codec, and **full-network replay: all 9,552
   spikes of a 1 s sugar-100 cascade on the 138,639-neuron graph identical to Brian2**, exact arithmetic and
   with production snapping eps = 1e-7 V.
4. Speed (Node/V8, M4, first version): 1 s of whole-brain sugar-100 in 0.63-0.80 s (1.2-1.6x real time).
5. Graph + per-neuron data packed (`tools/prepare_data.py`, `site/data/`).

## In progress / next steps
1. (running) `node tools/validate_engine.mjs --graph 783` -> JS vs Brian2 on all 17 conditions (30 trials each).
   Then v630 JS vs Brian2 v630 and vs the authors' parquet; extra replays (bitter, water, sugar 200) in
   `results/reference/replay_783_*.json` (generating) -> extend tests/replay.test.mjs.
2. docs/MODEL.md. 3. epsilon study (eps 0 vs 1e-7 vs 1e-6, many seeds/conditions) -> results JSON.
4. Page (frontend-design skill): three.js, worker engine, UI, loading state, About drawer, 375 px.
5. Media: `?capture=1`, 1080x1350 video, hero.png, blank-frame checks. 6. README / POST.md;
   verification-before-completion; final report.

## Open for Reza
(nothing yet)
