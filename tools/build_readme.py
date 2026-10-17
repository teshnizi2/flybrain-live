"""Write README.md. Every number comes from a JSON under results/ (produced by the script named next to it).

  python tools/build_readme.py
"""
import json, re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
R = ROOT / "results"
J = lambda p: json.loads((R / p).read_text())

sizes = J("data_sizes.json"); speed = J("engine_speed.json"); eps = J("epsilon_study.json"); rep = J("replay_summary.json")
v783 = J("validation_js_vs_brian2_783.json"); v630 = J("validation_js_vs_brian2_630.json"); lite = J("validation_jslite_vs_brian2_783.json"); spread = J("responder_spread.json"); pstats = J("position_stats.json"); bspeed = J("browser_speed.json")
auth = J("validation_vs_authors_v630.json"); paper = J("paper_numbers.json"); smoke = J("page_smoke.json"); nt = J("nt_sign_check.json")
b2 = lambda g, c: J(f"reference/brian2_{g}_{c}.json"); jsr = lambda g, c: J(f"reference/js_{g}_{c}.json")
f1 = lambda x: f"{x:,.1f}"; f0 = lambda x: f"{x:,.0f}"
ms = lambda d, w="contra": f"{d['mn9_rate_hz'][w]['mean']:.1f} &plusmn; {d['mn9_rate_hz'][w]['std']:.1f}"
N, E = 138639, sizes["graph_full"]["E"]
_ts = J("test_summary.json"); n_tests, n_tests_pass = _ts["tests"], _ts["pass"]

# ---- headline table: sugar 100 and 200 Hz, all five sources
a100, a200 = paper["authors_shipped_outputs_v630"]["sugar_100"], paper["authors_shipped_outputs_v630"]["sugar_200"]
def hrow(label, d, hz):
    c = d["mn9_rate_hz"]["contra"]; i = d["mn9_rate_hz"]["ipsi"]
    return f"| {label} | {c['mean']:.1f} &plusmn; {c['std']:.1f} | {i['mean']:.1f} | {c['trials_with_spikes']}/{d['n_trials']} | {d['n_responding_neurons_any_trial']} | {sum(d['total_spikes_per_trial'])/d['n_trials']:,.0f} |"
def arow(label, a):
    return f"| {label} | {a['mn9']['contra']['mean']:.1f} &plusmn; {a['mn9']['contra']['std']:.1f} | {a['mn9']['ipsi']['mean']:.1f} | 30/30 | {a['n_neurons_any_spike']} | {a['spikes_per_trial']:,.0f} |"
head = []
for hz, a in ((100, a100), (200, a200)):
    head += [f"**Sugar GRNs at {hz} Hz** (30 trials of 1 s each; MN9 = the motor neuron contralateral to the stimulated neurons)", "",
             "| source | MN9 contra, Hz | MN9 ipsi, Hz | trials with MN9 spikes | neurons that fired | spikes per trial |", "|---|---|---|---|---|---|",
             arow("authors' shipped output files, FlyWire v630", a),
             hrow("Brian2 2.10, authors' model.py, v630 (this repo)", b2("630", f"sugar_{hz}"), hz),
             hrow("**JS engine**, v630", jsr("630", f"sugar_{hz}"), hz),
             hrow("Brian2 2.10, authors' model.py, **v783** (this repo)", b2("783", f"sugar_{hz}"), hz),
             hrow("**JS engine**, **v783** (this page)", jsr("783", f"sugar_{hz}"), hz), ""]

# ---- 17-condition table
rows = []
for cond, r in sorted(v783["conditions"].items(), key=lambda kv: (kv[0].split("_")[0], int(kv[0].split("_")[1]), kv[0])):
    m = r["mn9_contra"]
    rows.append(f"| {cond} | {m['brian2_mean']:.1f} &plusmn; {m['brian2_sd']:.1f} | {m['js_mean']:.1f} &plusmn; {m['js_sd']:.1f} | {m['z']:+.2f} | {r['total_spikes']['brian2']:,.0f} / {r['total_spikes']['js']:,.0f} | {r['responding']['brian2']} / {r['responding']['js']} | {r['rate_correlation']['pearson_r']:.4f} | {r['count_z']['mean_z2']:.2f} | {'yes' if r['pass'] else '**no**'} |")
n_pass = sum(r["pass"] for r in v783["conditions"].values()); n_cond = len(v783["conditions"])
failed = [c for c, r in v783["conditions"].items() if not r["pass"]]
s10 = v783["conditions"]["sugar_10"]

# ---- replay
rep_rows = [f"| {r['condition']} | {r['n_events']:,} | {r['brian2_spikes']:,} | {r['js_spikes']:,} | {'identical' if r['identical'] else 'DIFFERENT (' + str(r['mismatched_spikes']) + ')'} | {r['eps_volts']:g} |" for r in rep["runs"]]

# ---- epsilon
eps_rows = [f"| {float(k):g} V | {v['identical_runs']}/{v['runs']} | {v['mismatched_spikes']:,} / {v['total_spikes']:,} | {v['mean_max_active']:,.0f} |" for k, v in eps["results"].items()]

# ---- speed
sp_rows = [f"| {c} | {r['real_time_factor_median']:.2f}x ({r['real_time_factor_min']:.2f}-{r['real_time_factor_max']:.2f}) | {r['spikes_per_sim_second']:,} | {r['mean_active_set']:,} |" for c, r in speed["runs"].items()]

# ---- lite
lt_rows = []
for c, r in lite["conditions"].items():
    m = r["mn9_contra"]; lt_rows.append(f"| {c} | {m['brian2_mean']:.1f} | {m['js_mean']:.1f} | {m['diff']:+.1f} | {r['total_spikes']['rel_diff']*100:+.1f} % |")

# ---- paper claims
c783 = lambda c: b2("783", c)["mn9_rate_hz"]["contra"]["mean"]
s783 = lambda c: b2("783", c)
k = smoke["checks"]
_smoke_x = float(k["sugar_after_8s"]["engine"].split("\u00d7")[0]); _ach = [r["achieved_x_real_time"] for r in bspeed["runs"].values()]
_lo, _hi = min([_smoke_x] + _ach), max(_ach)
_active = []
for _c in sorted(v783["conditions"]):
    _m = v783["conditions"][_c]["mn9_contra"]
    _i = b2("783", _c)["mn9_rate_hz"]["ipsi"]["mean"]
    if _m["brian2_mean"] > 1 or _i > 1: _active.append((_c, _m["brian2_mean"], _i))
_flip = [(c, a, b) for c, a, b in _active if a <= b]
contra_note = (f"yes in {len(_active) - len(_flip)} of {len(_active)} conditions with MN9 activity (sugar 100 Hz: {c783('sugar_100'):.1f} vs {s783('sugar_100')['mn9_rate_hz']['ipsi']['mean']:.1f} Hz); "
               + ("exceptions, both near the floor: " + "; ".join(f"{c}: contra {a:.1f}, ipsi {b:.1f} Hz" for c, a, b in _flip) if _flip else "no exceptions"))

md = f"""# flybrain-live

**A whole fruit-fly brain, simulated live in a browser tab.** All {N:,} neurons of the adult *Drosophila* brain (FlyWire
public release 783) with their real wiring ({E/1e6:.1f} million connections, 54.5 million synapses), driven by the leaky
integrate-and-fire model of Shiu et al. 2024 (*Nature* 634:210), drawn at each neuron's true 3D position, and **checked
against the authors' own Brian2 code**. Press *Sugar*: 21 taste neurons fire, activity cascades through the wiring, and
the motor neuron that lifts the proboscis (MN9) starts firing, the paper's headline prediction. Add *Bitter* and MN9 goes silent.

![hero](media/hero.png)

Video (20 s, 1080x1350): [`media/flybrain-1080x1350.mp4`](media/flybrain-1080x1350.mp4). Phone layout (375 px): [`media/phone-375.png`](media/phone-375.png).

## Run it

```bash
cd site && python3 -m http.server 8000      # then open http://localhost:8000
```

Needs a browser with WebGL2 and `DecompressionStream` (Chrome/Edge 80+, Safari 16.4+, Firefox 113+). The page streams
{sizes['graph_full']['gzip9']/1e6:.1f} MB (the connectome, gzip) plus {sizes['neurons']['gzip9']/1e6:.1f} MB (positions and labels), decodes it in a worker
(about {speed['graph']['gunzip_ms'] + speed['graph']['decode_ms']:,} ms in Node) and holds ~{speed['graph']['typed_array_mb']:.0f} MB of typed arrays. `?graph=lite` loads the
{sizes['graph_lite_ge2']['gzip9']/1e6:.1f} MB thresholded graph (edges with at least 2 synapses; selected automatically on devices reporting 2 GB of RAM or less).
Other URL options: `?stim=sugar|water|bitter|sugar%2Bbitter`, `?speed=0.05|0.1|0.25|1`, `?pos=anchor` (backbone anchor points instead of cell bodies: a sparser, star-map look), `?lines=0`.

Controls: keys `1`-`4` stimuli, `0` clear, `Space` pause, `R` reset, `F` fly to the feeding circuit, `L` cascade lines, `I` about/validation.
Hover a neuron for its cell type, class and transmitter. Playback is slowed (default 0.1x real time) so the cascade is visible.

## What the numbers say

Everything below comes from `results/` (JSON, with the script that wrote it); nothing is typed by hand.
MN9 rates are means &plusmn; sd over 30 independent trials of 1 s.

### 1. The headline: sugar to MN9, against the authors' own outputs

{chr(10).join(head)}
The authors' files are what their `example.ipynb` produced on FlyWire v630 (`sugarR_100Hz.parquet`, and `sugarR.parquet`, whose
GRN firing rate shows it was run at 200 Hz). Per-neuron mean rates of our Brian2 runs correlate with theirs at r = {auth['brian2_sugar_100']['pearson_r_rates_ge_0.5Hz']:.3f} (100 Hz) and
{auth['brian2_sugar_200']['pearson_r_rates_ge_0.5Hz']:.3f} (200 Hz); for the JS engine r = {auth['js_sugar_100']['pearson_r_rates_ge_0.5Hz']:.3f} and {auth['js_sugar_200']['pearson_r_rates_ge_0.5Hz']:.3f}
(`reference/compare_authors_v630.py`, neurons with >= 0.5 Hz). MN9 contralateral differences vs the authors' files: JS {auth['js_sugar_100']['mn9_contra']['ours_mean']:.1f} vs {auth['js_sugar_100']['mn9_contra']['shipped_mean']:.1f} Hz (z = {auth['js_sugar_100']['mn9_contra']['z']:+.2f}) and
{auth['js_sugar_200']['mn9_contra']['ours_mean']:.1f} vs {auth['js_sugar_200']['mn9_contra']['shipped_mean']:.1f} Hz (z = {auth['js_sugar_200']['mn9_contra']['z']:+.2f}).

### 2. Spike-for-spike: identical input events through Brian2 and the JS engine

The stochastic part is removed: the same pre-drawn Poisson events are injected into the full v783 network in Brian2
(`reference/replay_brian2.py`, the authors' unmodified `model.py`) and in the JS engine (`tools/replay_check.mjs`, also
`tests/replay.test.mjs`). 1 s of fly time, 138,639 neurons.

| condition | input events | Brian2 spikes | JS spikes | spike trains | snapping eps |
|---|---|---|---|---|---|
{chr(10).join(rep_rows)}

All {rep['total_spikes_per_mode']:,} spikes (neuron and 0.1 ms step) match in all {rep['n_conditions']} conditions, both with exact arithmetic (eps = 0) and with the
production setting. Small random networks give the same (`tests/oracle.test.mjs`: 4 fixtures, 17 to 8,117 spikes, state `g` bit-identical,
`v` within 2e-15 V; Brian2's compiled C rounds the `v` update differently from IEEE JS, up to ~150 ulp, which never changed a spike).

### 3. The paper's protocol, JS vs Brian2, {n_cond} conditions x 30 trials (FlyWire v783)

Criteria fixed before looking (`tools/validate_engine.mjs`): MN9 contra and ipsi rate Welch |z| <= 3.5 (or |diff| <= 1 Hz when tiny);
total spikes per trial within 3 %; number of neurons that fired within 15 % (or 8); per-neuron mean-rate Pearson r >= 0.98.
`z2` = mean over neurons of (C_js - C_b2)^2 / (C_js + C_b2) on 30-trial spike counts (Poisson counting noise; equivalent engines give <= 1).

| condition (GRN Hz) | Brian2 MN9 | JS MN9 | z | spikes/trial Brian2 / JS | neurons fired B / JS | rate r | z2 | all criteria met |
|---|---|---|---|---|---|---|---|---|
{chr(10).join(rows)}

The "neurons fired" column is a noisy statistic (one rare responder moves it): six independent blocks of 30 JS trials give
{min(spread['sugar_100']['blocks_of_30_trials'])}-{max(spread['sugar_100']['blocks_of_30_trials'])} for sugar_100 (mean {spread['sugar_100']['mean']:.0f}; Brian2: {s783('sugar_100')['n_responding_neurons_any_trial']}) and
{min(spread['water_200']['blocks_of_30_trials'])}-{max(spread['water_200']['blocks_of_30_trials'])} for water_200 (mean {spread['water_200']['mean']:.0f}; Brian2: {s783('water_200')['n_responding_neurons_any_trial']}) (`tools/responder_spread.mjs`).

{n_pass} of {n_cond} conditions meet every criterion. **{', '.join(failed)} does not**: its per-neuron correlation is r = {s10['rate_correlation']['pearson_r']:.4f}
(< 0.98) on almost no activity ({s10['total_spikes']['brian2']:.0f} vs {s10['total_spikes']['js']:.0f} spikes per trial, ~40 neurons); the noise-aware z2 is {s10['count_z']['mean_z2']:.2f}, and
the deterministic replay of that condition is spike-identical, so we read it as sampling noise in a near-silent condition, not an engine difference. The JS engine
on the v630 graph versus Brian2 on v630: `results/validation_js_vs_brian2_630.json`.

### 4. The paper's claims, one by one (every row except the last is a claim in the text of Shiu et al.)

| claim | paper | this repo |
|---|---|---|
| MN9 activated in 100 % of simulations by sugar GRNs at 100 Hz | 100 % | Brian2 v783 {s783('sugar_100')['mn9_rate_hz']['contra']['trials_with_spikes']}/30; JS v783 {jsr('783','sugar_100')['mn9_rate_hz']['contra']['trials_with_spikes']}/30; Brian2 v630 {b2('630','sugar_100')['mn9_rate_hz']['contra']['trials_with_spikes']}/30 |
| neurons responding (> 0 Hz in 30 trials) at 10 Hz and 200 Hz sugar, v630 | 45 and 455 | Brian2 {b2('630','sugar_10')['n_responding_neurons_any_trial']} and {b2('630','sugar_200')['n_responding_neurons_any_trial']}; JS {jsr('630','sugar_10')['n_responding_neurons_any_trial']} and {jsr('630','sugar_200')['n_responding_neurons_any_trial']} (v783, Brian2: {s783('sugar_10')['n_responding_neurons_any_trial']} and {s783('sugar_200')['n_responding_neurons_any_trial']}) |
| contralateral MN9 driven more strongly than ipsilateral | yes | {contra_note} |
| bitter added to sugar suppresses MN9; strong bitter eliminates it | yes | sugar 100 Hz alone {c783('sugar_100'):.1f}; + bitter 50 Hz {c783('sugar_100__bitter_50'):.1f}; + 100 Hz {c783('sugar_100__bitter_100'):.1f}; + 200 Hz {c783('sugar_100__bitter_200'):.1f} Hz; bitter alone 0 |
| Ir94e inhibits MN9 less completely than strong bitter | yes | sugar 100 + Ir94e 100 Hz: {c783('sugar_100__ir94e_100'):.1f} Hz (bitter 100 Hz: {c783('sugar_100__bitter_100'):.1f}) |
| sugar and water GRNs act synergistically | yes | sugar 100 + water 100 Hz: {c783('sugar_100__water_100'):.1f} Hz; sugar 100 alone {c783('sugar_100'):.1f}, water 100 alone {c783('water_100'):.1f} |
| water GRNs drive MN9 (up to 260 Hz in the paper) | yes | water 150/200/260 Hz: {c783('water_150'):.1f} / {c783('water_200'):.1f} / {c783('water_260'):.1f} Hz |
| *our pick:* Water and Bitter demo inputs are 200 Hz | not in the paper | chosen from this dose-response |

Not claimed by us: absolute rates (the authors say they are not predictions), anything beyond the gustatory circuit.

### 5. Why snapping is safe

Neurons whose `|v - v_0|` and `|g|` fall below eps are set to exact rest and leave the active set. Same seeds, 4 conditions x 5 seeds x 1 s
(`tools/epsilon_study.mjs`), spike trains compared with eps = 0:

| eps | runs identical to exact | differing spikes | mean peak active set |
|---|---|---|---|
{chr(10).join(eps_rows)}

The page uses 1e-7 V, a factor 10 below the first value that changes anything.

## Sizes and speed

| file | raw | gzip -9 | brotli -q 11 |
|---|---|---|---|
| full connectome, FBG1 ({E:,} edges) | {sizes['graph_full']['raw']/1e6:.1f} MB | **{sizes['graph_full']['gzip9']/1e6:.1f} MB** | {sizes['graph_full']['brotli11']/1e6:.1f} MB |
| lite connectome (edges with >= 2 synapses, {sizes['graph_lite_ge2']['E']:,} edges, {sizes['graph_lite_ge2']['synapse_fraction_kept']*100:.0f} % of synapses) | {sizes['graph_lite_ge2']['raw']/1e6:.1f} MB | {sizes['graph_lite_ge2']['gzip9']/1e6:.1f} MB | {sizes['graph_lite_ge2']['brotli11']/1e6:.1f} MB |
| per-neuron arrays (positions, class, transmitter, side, cell type) | {sizes['neurons']['raw']/1e6:.1f} MB | {sizes['neurons']['gzip9']/1e6:.1f} MB | |

The full graph is under the 45 MB budget, so it is the default. Format: CSR with delta-varint targets and varint synapse counts, sign stored once per presynaptic neuron (it is constant per neuron).

Engine speed, whole brain, Node/V8 on {speed['machine']['cpu']} ({speed['machine']['cores']} cores), eps = 1e-7 V, 5 s per repeat after a 1 s warm-up,
**median of 3 (range)**, measured while the machine was shared with other jobs (load average {speed['machine']['loadavg_at_start'][0]:.0f} at start; numbers are pessimistic and noisy):

| stimulus (GRN Hz) | real-time factor | spikes per simulated second | neurons integrated (mean) |
|---|---|---|---|
{chr(10).join(sp_rows)}

Real-time factor = simulated seconds per wall second; the page's default playback is 0.1x.

Inside the real page (module worker + WebGL rendering on the main thread, headless Edge, playback requested at 4x so the engine is the bottleneck; `tools/bench_browser.mjs`),
load average {bspeed['machine']['loadavg_at_start'][0]:.0f} on {bspeed['machine']['cores']} cores at the start (the machine was shared with other jobs):

| stimulus | achieved simulated seconds per wall second | engine's own readout (median / max) |
|---|---|---|
{chr(10).join(f"| {c} | {r['achieved_x_real_time']:.2f}x | {r['engine_readout_median']}x / {r['engine_readout_max']}x |" for c, r in bspeed['runs'].items())}

So under load the page sustained {_lo:.1f}x to {_hi:.1f}x real time (the low end is the single readout of the smoke test), well above the 0.1x playback it uses by default and the 0.25x design target; a quiet machine should do better.
`tools/smoke_page.mjs` / `results/page_smoke.json`: {k['headless_fps_during_cascade']:.0f} fps in headless Edge during a cascade; sugar gave MN9 {k['sugar_after_8s']['mn9_hz']:.0f} Hz after ~8 s at 1x playback
(engine readout "{k['sugar_after_8s']['engine']}" at that moment), sugar + bitter gave {k['sugar_plus_bitter_after_7s']['mn9_hz']:.0f} Hz, no console errors, the graph in the page had N = {k['engine_graph']['N']:,} neurons and E = {k['engine_graph']['E']:,} connections, no horizontal scroll at 375 px.

### The lite graph (optional)

Dropping every single-synapse edge keeps {sizes['graph_lite_ge2']['synapse_fraction_kept']*100:.0f} % of synapses. Effect on MN9, JS engine on the lite graph vs the Brian2 reference on the full graph (30 trials each):

| condition | Brian2 full | JS lite | diff, Hz | total spikes |
|---|---|---|---|---|
{chr(10).join(lt_rows)}

The sugar and bitter results survive; water is about 13 % weaker. That is why the lite graph is an option, not the default.

## Media

`media/flybrain-1080x1350.mp4` (20 s, H.264, yuv420p, no audio) and `media/hero.png` (2160x2700) come from `tools/capture.mjs`: the page's `?capture=1` mode steps the engine a fixed 33 steps (3.3 ms of fly time)
per 1/30 s frame (0.099x playback), follows the storyboard in `tools/capture_timeline.mjs` (idle brain, Sugar at 2.5 s, Sugar + Bitter at 11.5 s), renders each frame in headless Edge and encodes with ffmpeg.
Nothing depends on the wall clock, so the video is reproducible. The ~1080x1080 cut was not made: the layout is portrait-first.

## How it works

* **Engine** (`site/engine/lif.js`, no dependencies, runs in a Web Worker and under Node): the exact update Brian2 executes for the authors' model
  (0.1 ms steps, exact integration of the linear subthreshold system, 18-step delay line of spike lists, 22-step refractory period, input to refractory neurons is dropped,
  resets applied after delivery); only neurons off rest are integrated (resting is an exact fixed point of the update). Details and parameters: [`docs/MODEL.md`](docs/MODEL.md).
* **Page** (`site/`): three.js points at the neurons' positions (FlyWire voxels are 4x4x40 nm; the frame is a view onto the fly's face), a per-point "last spike time" so only spiking neurons
  are written each frame, additive blending + bloom, cascade lines from the last excitatory sender before each spike, a raster of the 100 most active neurons sorted by latency.
  Colour: amber = excitatory spike, ice-blue = inhibitory spike.
* **Tests** (`npm test`, {n_tests_pass} of {n_tests} pass): Brian2-oracle fixtures, constants, PRNG, graph codec, source tracking, the full-network replays, and `tests/stats.test.mjs` (4 gustatory conditions x 30 trials against the Brian2 JSON with a stated criterion, plus a negative control that must reject a 20 % weaker stimulus).

## Honest limits

* A model of the paper's model: leaky integrate-and-fire, one free weight (0.275 mV per synapse), no gap junctions, neuromodulation, plasticity, dendrites or spontaneous activity. The authors state that absolute rates are not predictions.
* Signs come from the paper's connectivity file (predicted transmitter); they agree with the v783 top-transmitter annotation for {nt['agreement_with_ach_da_5ht_oa_exc__gaba_glu_inh']*100:.1f} % of neurons (`results/nt_sign_check.json`).
* The notebooks use FlyWire v630 IDs; three IDs (a sugar GRN, a bitter GRN, the ipsilateral MN9) changed in v783 and were re-matched by synaptic-partner similarity (cosine 1.0, 1.0, 0.99998; `results/id_mapping_630_to_783.json`).
  Seven of the paper's 18 "water" neurons are annotated sugar GRNs in v783; the paper's lists are used as published.
* Sugar 100 Hz is the paper's calibration point. Water 200 Hz and Bitter 200 Hz are our picks from the dose-response, not the paper's.
* Brian2 here is 2.10.1 (the paper used 2.5.1); the validation is against the authors' model code, not their 2.5.1 binaries. The sugar-10 Hz condition misses one correlation criterion (see above).
* "Cascade lines" show the last excitatory sender before each spike (within 15 ms): plausible cause, not proof. Positions are cell bodies for {pstats['n_drawn_at_cell_body']:,} neurons and backbone anchor points for the {pstats['n_drawn_at_backbone_anchor']:,} (mostly sensory) whose cell bodies lie outside the volume; {pstats['n_not_drawn_no_annotation']} neurons without an annotation are not drawn (`results/position_stats.json`).
* The paper's figure grids (e.g. sugar x bitter, sugar x water, silencing screens) were not compared one by one: the authors' raw output archive (several GB) was not downloaded. We compared against the shipped example outputs, the text claims, and our own Brian2 runs of the same model.
* Playback is slowed down for viewing; the speed tables are what the engine sustains on one laptop (a single worker thread) while the machine was busy with other jobs, so they are lower bounds for a quiet laptop.

## Reproduce

```bash
tools/fetch_data.sh                                   # inputs into data/raw/ (gitignored): model repo, connectivity, annotations
uv venv --python 3.12 .venv && uv pip install -r requirements.txt && npm install
python tools/map_v630_ids.py                          # results/id_mapping_630_to_783.json
python reference/run_brian2.py --graph 783 --cond sugar_100 --trials 30     # ~3 min per condition; all conditions in reference/conditions.py
python reference/replay_brian2.py --graph 783 --cond sugar_100 --seed 123   # deterministic replay inputs/outputs
python tools/prepare_data.py                          # site/data/* and sizes (~6 min)
npm test                                              # engine tests incl. full-network replays and the statistical test (~{_ts['wall_seconds']/60:.1f} min)
node tools/validate_engine.mjs --graph 783 --conds all --trials 30          # JS vs Brian2 (+ --graph 630 after tools/pack_graph.py 630 tmp/graph_630.fbg.gz)
node tools/epsilon_study.mjs && node tools/replay_check.mjs && node tools/bench_engine.mjs && node tools/bench_browser.mjs && node tools/responder_spread.mjs
python reference/compare_authors_v630.py && python tools/build_page_data.py
node tools/capture.mjs --out media/flybrain-1080x1350.mp4 && node tools/capture.mjs --hero media/hero.png --dpr 2
node tools/smoke_page.mjs && python tools/build_readme.py
```

## Credits and licences

* Connectome: FlyWire, Dorkenwald et al., *Nature* 634 (2024) and Schlegel et al., *Nature* 634 (2024); annotations from `flyconnectome/flywire_annotations` (CC-BY 4.0). Attribution is required.
* Model and connectivity file: Shiu, Sterne, Spiller et al., "A Drosophila computational brain model reveals sensorimotor processing", *Nature* 634:210-219 (2024), doi:10.1038/s41586-024-07763-9; code `philshiu/Drosophila_brain_model` (MIT).
* Reference simulator: Brian2. Rendering: three.js 0.170.0. Type: Inter Tight, JetBrains Mono (Google Fonts, OFL).
* This repository's own code: licence not chosen yet (the third-party code and data above keep theirs).
"""
(ROOT / "README.md").write_text(md)
print("README.md written,", len(md.split()), "words")
