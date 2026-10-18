# flybrain-live: STATE

Handoff note. Update after every step. Last updated: 2026-10-18 (deployed and published, see "Deployed and published"; the build notes below date from 2026-10-17).

## Goal
Whole adult fruit-fly brain (FlyWire v783, 138,639 neurons, 15.09 M connections) simulated live in a
browser tab with the Shiu et al. 2024 (Nature 634:210) LIF model, drawn at real 3D neuron positions,
validated against the paper's own Brian2 code. See BRIEF.md and ../visual-series-RULES.md (build rules at the time: local only,
no ALICE, no publishing; publishing was approved by Reza on 2026-10-18; commits have no attribution lines).

## Status: DONE except final polish/verification
Default positions = cell bodies (`?pos=anchor` for backbone anchors; chosen after a side-by-side render, soma shows the real brain silhouette). Everything in BRIEF "Done means" exists and is verified (see README for the tables, all generated from results/):
- page runs locally with all neurons (`cd site && python3 -m http.server`), media exist, engine tests pass.

## Key decisions
- Reference = the authors' own `model.py` under Brian2 (cython target works on this M4: ~5 s per 1 s trial, 2 GB RSS),
  so no NumPy/Numba clone was needed. Brian2 here is 2.10.1 (paper: 2.5.1).
- Engine mirrors the code Brian2 generates (docs/MODEL.md): step order state update -> threshold -> synapses (delayed spikes, then
  Poisson/events) -> reset; delay 18 steps; refractory 22 steps; input to refractory targets (synaptic AND Poisson) is dropped; spiking
  neuron is refractory for the rest of its step; Poisson adds 68.75 mV to v (rfc = 0 for those neurons) so GRN rate = r(1 - r dt).
  Brian2's compiled `v` update differs from IEEE JS by <= 150 ulp (1e-15 V); `g` exact; spikes identical in every test.
- FlyWire v630 IDs in the notebooks: 3 changed in v783 (sugar GRN, bitter GRN, ipsilateral MN9), re-matched by partner cosine
  (1.0, 1.0, 0.99998). Paper's "right" sugar set is `side=left` in the v783 annotation: UI says contralateral/ipsilateral.
  7 of the paper's 18 "water" IDs are LB3c sugar GRNs in v783 annotation; lists used as published.
- Full graph is the default (30.7 MB gzip, 26.2 brotli, < 45 MB); lite (edges >= 2 synapses, 17.1 MB, 86 % of synapses) via `?graph=lite`
  and automatically when `navigator.deviceMemory <= 2`. Lite effect: sugar/bitter unchanged, water -13 %.
- Production snapping eps = 1e-7 V (identical to exact for eps <= 1e-6 in 20 runs; changes spikes at 1e-5).
- Demo stimuli: Sugar 100 Hz (paper calibration), Water 200 Hz, Bitter 200 Hz, Sugar + Bitter (100 + 200); Water/Bitter rates are OUR picks.
- Display frame: view onto the fly's face (view = -(x-cx), -(y-cy), -(z-cz) of the 4x4x40 nm voxel coords, in um / 100).
- Fonts: Inter Tight + JetBrains Mono (series rule); three.js 0.170.0 from jsDelivr (pinned); both need network.

## Layout of the repo
- `site/` the page (index.html, style.css, app.js, scene.js, raster.js, worker.js, engine/{lif,graph,prng}.js, data/*)
- `reference/` Brian2 drivers (run_brian2.py, replay_brian2.py), conditions.py, compare_authors_v630.py, sets_*.json
- `tools/` fetch_data.sh, prepare_data.py, graph_codec.py, pack_graph.py, map_v630_ids.py, validate_engine.mjs, replay_check.mjs,
  epsilon_study.mjs, bench_engine.mjs, responder_spread.mjs, capture.mjs + capture_timeline.mjs, smoke_page.mjs, build_page_data.py, build_readme.py
- `tests/` (`npm test`, 41 tests incl. a ~4 min statistical JS-vs-Brian2 test): oracle fixtures from Brian2, engine, prng, graph codec, source tracking, full-network replays
- `results/` all numbers (JSON), `results/reference/` Brian2 + JS runs and replay files; `docs/MODEL.md`; `README.md`, `POST.md`
- `media/flybrain-1080x1350.mp4` (20 s), `media/hero.png` (2160x2700), `media/phone-375.png`
- Not in git: data/raw, vendor, .venv, node_modules, tmp.

## Results in one place (v783, 30 trials x 1 s, MN9 contralateral Hz)
Brian2 / JS: sugar100 68.7 / 67.1 | sugar200 93.3 / 95.1 | water200 30.3 / 32.4 | bitter200 0 / 0 | sugar100+bitter200 0.1 / 0.1.
Authors' shipped v630 files: sugar100 67.0 (JS v630 66.7, Brian2 v630 69.6), sugar200 93.3 (92.5, 92.8); per-neuron rate r = 1.000.
Replay: 5 whole-brain conditions, 44,328 spikes, identical (eps 0 and 1e-7). JS vs Brian2 stochastic: 16 of 17 conditions meet all
pre-stated criteria; sugar_10 misses the r >= 0.98 criterion (0.977) on ~250 spikes per trial (z2 = 0.76, replay identical).
Engine speed (Node, M4 shared with other jobs): medians 1.3x-3.6x real time over 7 stimuli; in the page (headless Edge, load ~12-14) 0.9x-1.4x (results/browser_speed.json).

## How to resume / regenerate
See README "Reproduce". Quick checks: `npm test`; `node tools/smoke_page.mjs`; `python tools/build_readme.py`.

## Deployed and published (2026-10-18, approved by Reza)
- Live: https://flybrain.teshnizi.dev (also https://flybrain-live.vercel.app). Vercel project `flybrain-live` (team hmkhd2-1413s-projects, `prj_VM3GmPOc6jkQ6KhHEYT2chIIka9B`), static deploy of `site/`, no build step; the subdomain is attached to the project, so every production deploy updates it.
- Code: https://github.com/teshnizi2/flybrain-live (public, MIT licence, chosen by Reza).
- Redeploy after changing `site/`: `cd site && vercel deploy --prod --yes --scope hmkhd2-1413s-projects` (CLI logged in as rezateshnizi; `site/.vercel/` is gitignored), then `git push`.
- Checked live: all 17 served files are byte-identical to `site/` (SHA-256, including the 30.7 MB graph); in the in-app browser the page ran the simulation, Sugar gave MN9 69 Hz with no console errors, and the 375 px layout has no horizontal scroll. The in-app pane was hidden, so its 0.3x real-time reading is not a speed measurement (the README numbers stand).
- Share card: `site/og.jpg` (1200x630, a crop of `media/hero.png`) plus Open Graph, Twitter and canonical tags in `site/index.html`.
- Hosting limits: Vercel Hobby includes 100 GB/month of Fast Data Transfer for the whole team (it also serves www.studypuff.com); sustained overage can lead to paused deployments (Vercel warns first; fix = upgrade to Pro or cut traffic). One first visit transfers about 33 MB here (30.7 MB graph + 2.0 MB positions and labels), so roughly 3,000 first visits use the allowance. If a post takes off, move the heavy files to a host with free egress or upgrade the team to Pro.

## Open for Reza
1. Deployment: DONE 2026-10-18 (see above). The host serves the `.gz` files as binary and the page gunzips itself; fonts and three.js come from Google Fonts and jsDelivr.
2. Water and Bitter demo input rates (200 Hz) are my picks from the dose-response; change `PRESETS` in `site/app.js` and `REF_KEY` + `tools/build_page_data.py` if you prefer others.
3. The ~1080x1080 video cut was not made (layout is portrait-first); the 4:5 video and a 2160x2700 still exist.
4. The paper's water list vs the v783 annotation (7 of 18 labelled sugar) is a small honesty footnote in the About drawer and README; decide if you want it in the post.

5. Licence: MIT, chosen by Reza on 2026-10-18 (`LICENSE`, `package.json`, README); the upstream code/data keep MIT / CC-BY 4.0.

## Next step (if any)
Nothing required. Optional polish: second video cut, brotli precompression if the host supports it, hosting.
