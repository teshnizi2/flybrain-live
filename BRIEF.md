# flybrain-live: a whole fruit-fly brain, simulated live in a browser tab

Read `~/Random projects/visual-series-RULES.md` first. Those rules apply here.

## The one-line pitch
All neurons of the adult *Drosophila* brain (FlyWire v783, ~139k neurons, with the real synaptic
wiring), simulated with the leaky integrate-and-fire model of **Shiu et al. 2024 (Nature)**, live in a
browser tab, drawn at each neuron's true 3D position. You press "sugar" and watch activity cascade
through the brain until the proboscis motor neuron MN9 fires, reproducing the paper's headline
prediction.

## Why this, why now
Since MaleCNS v1.0 (June 2026) and its Cell paper (3 Sep 2026), GitHub has filled with "fly brain does
X" demos (desktop-fly, doomfly, FlyDrones, fly-eye, fly_ocr, werm; see `awesome-fly`). The browser
ones run *crops* (3k to 23k neurons) or reduced "mini" models. Our differentiator is the **whole brain
and the published model, validated against the paper's own code, in a tab**. Credibility is the
product: Reza's brand is honest reproduction.

## Sources (download into `data/raw/`, gitignored)
- `philshiu/Drosophila_brain_model` (MIT): `Completeness_783.csv`, `Connectivity_783.parquet`
  (~100 MB), `model.py`, `example.ipynb`, `figures.ipynb`, `utils.py`, `sez_neurons.pickle`, and
  whatever is in `results/`. Raw URL pattern:
  `https://github.com/philshiu/Drosophila_brain_model/raw/main/<file>`.
- Neuron positions and labels: `flyconnectome/flywire_annotations`,
  `supplemental_files/Supplemental_file1_neuron_annotations.tsv` (~32 MB): root_id (v783), pos_x/y/z,
  soma_x/y/z, super_class, cell_class, cell_type, side, and more. Work out the units (FlyWire voxels are
  4×4×40 nm; check whether the columns are in voxels or nm) so the brain isn't squashed.
- The paper: Shiu, Sterne, Spiller et al., "A Drosophila computational brain model reveals
  sensorimotor processing", Nature 634, 210–219 (2024), doi:10.1038/s41586-024-07763-9 (open access).
  Data credits: FlyWire (Dorkenwald et al. 2024, Schlegel et al. 2024, Nature), CC-BY 4.0. Attribution
  is required on the page and in the README.

## Steps

### 1. Understand the reference exactly
Read `model.py`, `example.ipynb` and `figures.ipynb` fully. Extract into `docs/MODEL.md`:
- every parameter (v_0, v_rst, v_th, t_mbr, tau, t_rfc, t_dly, w_syn, r_poi, f_poi, dt);
- the equations and the reset rule;
- how weights are built (synapse count × sign from the predicted neurotransmitter);
- how Poisson input is applied (target variable, weight);
- the "unless refractory" semantics;
- the integration method Brian2 uses for these equations.

Also extract the exact neuron ID lists used for the gustatory experiments: sugar GRNs (the paper
uses the right-side set), bitter GRNs, water GRNs, and MN9 (both sides), plus the stimulation
frequencies and the durations/trial counts used. Get the published numbers to compare against: the
MN9 rates for each condition, from the paper text/figures or the repo's `results/`.

### 2. Reference run (Python)
Set up `.venv` (uv, Python 3.12) with brian2, pandas, pyarrow, numpy, numba. Reproduce at least:
sugar → MN9, water → MN9, bitter alone, and sugar+bitter (bitter suppressing the sugar response, as in
the paper). Use the paper's protocol (1 s, Poisson-driven GRNs at the paper's rate). Use as many trials
as the runtime allows, and state N.

Brian2 on 139k neurons and millions of synapses may be slow or memory-hungry on a 16 GB Mac. If it is:
- write a NumPy/Numba clone of the identical discrete-time model;
- verify it against Brian2 on 2 conditions with a few trials each;
- then run the full protocol with the clone.

Save everything to `results/reference/*.json`. Compare with the paper's numbers in a table.

### 3. JavaScript engine (`site/engine/`, TDD)
An ES module with no dependencies, running in a Web Worker and also under Node for tests. Requirements:
- Same model and update order as the reference: dt = 0.1 ms, exact integration of the linear subthreshold system, refractory clamp, delay via a ring buffer of spike lists (not a per-synapse queue), seeded PRNG for the Poisson input.
- Speed: active-set optimisation (only neurons with non-rest state are integrated; snap to rest below a tiny epsilon, and prove the epsilon doesn't change results). The target is ≥0.25× real time for the whole brain on an M4 (report the measured real-time factor). Fall back to WASM or WebGPU only if JS can't get close.
- Write the tests first. `node --test` compares JS rates with the reference JSON for the gustatory conditions, within statistical tolerance (state the criterion).

### 4. Pack the connectivity for the web
Build a compact binary CSR (offsets + delta/varint-coded targets + signed weights) and decode it in
the worker. Measure the compressed sizes.
- If the full graph is ≤ ~45 MB over the wire (gzip/brotli as a static host would serve it), make it
  the default.
- Otherwise make a thresholded "lite" graph the default, keep the full graph selectable, and report
  how much each variant changes the MN9 result versus the full reference. Lead with whichever is honest.

### 5. The page (invoke `frontend-design` first)
- three.js points at the soma positions (pos_x/y/z when soma is missing), centred and scaled. Faint
  base colour by super_class, with a brightness buffer flashing on spikes (amber to white, a fast
  decay) under additive blending and a tasteful bloom. Orbit controls, with a slow auto-rotate when idle.
- Stimulus buttons: Sugar, Water, Bitter, Sugar + Bitter, Clear (plus intensity if it's cheap). Mark
  the stimulated neurons and MN9 with small labelled markers.
- Readouts: MN9 rate (Hz) with a meter and a tiny proboscis-extension glyph, sim time, spikes/s,
  active neurons, real-time factor. Add a raster strip of the ~100 most active neurons.
- An "About" drawer covering: what's real (wiring, positions); what's modelled (LIF, signs from the
  predicted transmitter, no gap junctions/neuromodulation/plasticity); how it was validated (the
  table); and credits.
- It must still render something meaningful at 375 px width. Loading state: show progress while the
  graph downloads and decodes.

### 6. Media
- `?capture=1` deterministic mode. Record a ~20 s 1080×1350 video (`media/flybrain-1080x1350.mp4`):
  the idle brain slowly rotating, then Sugar pressed, the cascade, and the MN9 meter rising.
- A hero still: `media/hero.png`.
- Verify the frames aren't blank.

### 7. Docs
`README.md` (results table: paper vs our reference vs browser engine; sizes and speed; limits;
credits), `STATE.md`, `POST.md`.

## Done means
- The page runs locally with all neurons.
- The gustatory results match the paper within stated tolerance, or the mismatch is documented
  honestly.
- The engine tests pass.
- The media exists and looks good.
- The README numbers trace to `results/`.
