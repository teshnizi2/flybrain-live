# flybrain-live: STATE

Handoff note. Update after every step. Last updated: 2026-10-17 12:30 (session 1, resumed after a process crash).

## Goal
Whole adult fruit-fly brain (FlyWire v783, 138,639 neurons, 15.09 M connections) simulated live in a
browser tab with the Shiu et al. 2024 (Nature 634:210) LIF model, drawn at real 3D neuron positions,
validated against the paper's own Brian2 code. See BRIEF.md and ../visual-series-RULES.md (local only:
no ALICE, no publishing, no push; commits have no attribution lines).

## Decisions so far
- Reference = the authors' own `model.py` run unmodified under Brian2 (cython target works on this M4:
  ~5 s per 1 s trial, 2 GB RSS, 18 s to build). So no NumPy/Numba clone is needed for the protocol.
- Brian2 here is 2.10.1 (paper used 2.5.1). The generated update code was read; mirrored in
  `site/engine/lif.js` (details to go into docs/MODEL.md): schedule per step = state update ->
  threshold -> synapses (delayed spikes, then Poisson/events) -> reset; delay 18 steps; refractory
  22 steps = `timestep(2.2 ms)`; inputs (synaptic AND Poisson) are DROPPED while the target is refractory
  (Brian2 guards `g += w` and the Poisson `v += ...` with `not_refractory`); a neuron that spiked is
  refractory for the rest of that step; Poisson event adds 68.75 mV to v (rfc = 0 for those neurons), so an
  event on the step right after a spike is lost and the GRN rate is r*(1 - r*dt); the reset wipes input
  that arrived in the spike step; `w = 0` in model.py's reset string is a no-op (no such neuron variable).
- The notebooks use FlyWire **v630** IDs. 3 IDs vanished in v783 (1 sugar GRN, 1 bitter GRN, the
  ipsilateral MN9). Matched by synaptic-partner cosine similarity (1.0, 1.0, 0.99998;
  `tools/map_v630_ids.py`, `results/id_mapping_630_to_783.json`).
- Sides: the v783 annotation labels the paper's "right" sugar GRNs `side=left` (nerve-entry side) and
  MN9 `720575940660219265` (paper: "left", contralateral to the sugar set) `side=right`. UI avoids
  left/right and says contralateral / ipsilateral to the stimulated GRNs.
- Orientation from the data: low z = anterior, high y = ventral, annotation left = small x.
  Voxels are 4x4x40 nm; brain spans ~815 x 390 x 278 um.
- Graph facts: sign is constant per presynaptic neuron (96,672 excitatory, 41,333 inhibitory); no
  duplicate or self edges; 54.5 M synapses in 15.09 M edges, 50% of edges have count 1.
  Packed estimate (original neuron order): targets delta-varint 27.1 MB raw / 24.4 MB gzip / 20.9 MB
  brotli; weights 15.1 MB raw / 6.2 gzip / 5.1 brotli => ~31 MB gzip, ~26 MB brotli < 45 MB, so the FULL graph
  is the default (lite graph only as an optional extra).
- Product stimulus defaults (all have Brian2 references, 30 trials): Sugar 100 Hz (paper's calibration
  point), Water 200 Hz, Bitter 200 Hz, Sugar+Bitter = 100 + 200 Hz.

## Environment
- `.venv` (uv, Python 3.12; pins in requirements.txt): brian2 2.10.1, numpy, pandas, pyarrow, scipy, numba.
  Node v22 (`npm test` = `node --test tests/*.test.mjs`).
- `tools/fetch_data.sh` downloads inputs into `data/raw/` (gitignored).
- Throwaway files: session scratchpad `.../scratchpad/flybrain/` (not needed to resume).

## What works / done
1. Data downloaded; ID mapping done.
2. **Brian2 reference runs: DONE** (`reference/run_brian2.py`, `reference/conditions.py`,
   `results/reference/brian2_<graph>_<cond>.json`, 21 files x 30 trials x 1 s, no errors).
   Headline v783 (MN9 contralateral, Hz mean +- sd over 30 trials): sugar10 0 | sugar25 0.0 | sugar50 18.1 |
   sugar100 68.7+-4.8 (30/30 trials fire) | sugar150 84.3 | sugar200 93.3 | water100 0 | water150 6.1 |
   water200 30.3 | water260 53.1 | bitter100/200 0 | sugar100+bitter50 36.8 | +bitter100 4.6 | +bitter200 0.1 |
   sugar100+Ir94e100 16.5 | sugar100+water100 86.3 (synergy). 403 neurons respond at sugar 100 Hz.
   Validation vs the authors' SHIPPED v630 outputs (results/example/*.parquet): sugar 100 Hz MN9
   67.0+-6.6 (theirs) vs 69.6+-3.6 (ours, v630); sugar 200 Hz 93.3+-3.2 vs 92.8+-5.5; neurons 404/448 vs
   405/450; spikes/trial 9636/17052 vs 9852/16980. Paper text: 45 neurons respond at 10 Hz, 455 at 200 Hz
   (v630); ours 39 and 450.
3. JS engine v0 written test-first: `site/engine/{lif,graph,prng}.js`; Brian2-oracle fixtures
   (`tests/fixtures/make_fixtures.py`) -> spike trains IDENTICAL to Brian2 on 4 random networks
   (17 to 8117 spikes). 18/22 tests pass. The 4 failing "bit-identical v trace" tests differ by up to 144 ulp
   (~1e-15 V); g is exact. Cause under investigation: FMA contraction in Brian2's arm64 build
   (`-march=native`/fast-math) vs plain IEEE in JS. Plan: assert |dv| <= 2e-15 V and g exact, document.

## Open items / next steps
1. (in progress) Settle the trace tolerance; commit the engine.
2. docs/MODEL.md (parameters, equations, ordering, ID lists, published numbers).
3. Full-network deterministic replay vs Brian2 (v783) + stochastic comparison tables
   (JS vs Brian2 for the 21 conditions, 30 trials, z-test + rate correlation), ulps/epsilon proof
   (eps = 0 vs production eps), v630 JS vs the authors' parquet.
4. Pack graph (`tools/prepare_data.py`: FBG1 graph + positions + classes + key sets), measure sizes.
5. Page (frontend-design skill): three.js, worker engine, UI, loading state, About drawer, 375 px.
6. Media: `?capture=1`, 1080x1350 video, hero.png, checks for blank frames.
7. README / POST.md; final verification-before-completion.

## Open for Reza
(nothing yet)
