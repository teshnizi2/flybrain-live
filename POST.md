# POST.md (draft only, never posted)

## Links (deployed 2026-10-18)

- Demo: https://flybrain.teshnizi.dev (first load downloads the 30.7 MB graph; low-memory devices get the 17.1 MB lite graph automatically)
- Code: https://github.com/teshnizi2/flybrain-live (MIT)
- The URL is not part of the 108 words. LinkedIn builds the link card from the page's share image (`site/og.jpg`).

## Draft (108 words)

I simulated a whole fruit-fly brain, live, in a browser tab.

All 138,639 neurons and 15.1 million connections of the FlyWire connectome, running the Shiu et al. 2024 integrate-and-fire model, rebuilt in JavaScript. Press sugar: 21 taste neurons fire, activity cascades through the real wiring, and MN9, the motor neuron that extends the proboscis, reaches about 67 Hz. Add bitter and it drops to almost nothing.

And it's not a lookalike. Given identical inputs, it reproduces all 44,328 spikes of the authors' own Brian2 code. Over 30 trials, MN9 lands within noise of their model (67.1 vs 68.7 Hz).

On my laptop it runs close to real time.

## Alternative hooks

1. Every neuron. Every synapse. Live in your browser tab.
2. A fly tastes sugar. 138,639 neurons light up, and one motor neuron says: extend the proboscis.
3. Most online brain simulations run a crop of the brain. This runs all of it, and matches the paper's own code spike for spike.

## Where the numbers come from

| number in the draft | source |
|---|---|
| 138,639 neurons, 15.1 million connections | `site/data/meta.json` (N, E), `results/data_sizes.json` (15,091,983 edges) |
| 21 taste neurons | `reference/conditions.py` (sugar set), `results/id_mapping_630_to_783.json` |
| MN9 about 67 Hz, 67.1 vs 68.7 Hz, 30 trials | `results/reference/js_783_sugar_100.json`, `results/reference/brian2_783_sugar_100.json`, `results/validation_js_vs_brian2_783.json` |
| bitter makes it fall to zero | `results/reference/js_783_sugar_100__bitter_200.json` (0.1 Hz, Brian2 0.1 Hz) |
| all 44,328 spikes reproduced | `results/replay_summary.json` (`tools/replay_check.mjs`, `reference/replay_brian2.py`) |
| about real time in a tab | `results/browser_speed.json`: 0.9x to 1.4x in the page for sugar, water, sugar + bitter; `results/engine_speed.json`: 2.4x to 3.6x in Node for the four demo stimuli (M4, machine shared with other jobs) |

Attach `media/flybrain-1080x1350.mp4`, or `media/hero.png` as the still. The page is deployed (see Links above).
