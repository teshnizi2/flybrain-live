# The model, exactly as executed

Everything here was read from `philshiu/Drosophila_brain_model` (`model.py`, `example.ipynb`, `figures.ipynb`,
commit 91bdd1e, MIT licence) and from the code Brian2 generates for it. Where the two differ in what they
*say* versus what they *do*, this file records what they do. The JS engine (`site/engine/lif.js`) mirrors it, and
`tests/` prove that on the whole brain.

## 1. Parameters (`default_params` in model.py)

| symbol | model.py | value | source cited by the authors |
|---|---|---|---|
| resting potential | `v_0` | -52 mV | Kakaria & de Bivort 2017 |
| reset potential | `v_rst` | -52 mV | " |
| spike threshold | `v_th` | -45 mV | " |
| membrane time constant | `t_mbr` | 20 ms (C = 2 uF/cm2 x R = 10 kOhm cm2) | " |
| synaptic decay | `tau` | 5 ms | Jurgensen et al. 2021 |
| refractory period | `t_rfc` | 2.2 ms | Lazar et al. 2021 |
| spike-to-PSP delay | `t_dly` | 1.8 ms | Paul et al. 2015 |
| weight per synapse | `w_syn` | 0.275 mV (the one free parameter) | chosen so 100 Hz sugar gives ~80 % of maximal MN9 firing |
| Poisson rate | `r_poi`, `r_poi2` | per experiment (Hz) | stimulation frequency of the first / second neuron set |
| Poisson scale | `f_poi` | 250 | "sufficient to cause spiking" |
| time step | Brian2 default clock | 0.1 ms | not set in model.py |
| trial length, count | `t_run`, `n_run` | 1000 ms, 30 | |

Floating-point detail: Brian2 evaluates `-52*mV` as `-52 * 0.001 = -0.052000000000000005`. The engine uses the same
expressions so the doubles are identical.

## 2. Equations

Each neuron has a membrane potential `v` and a conductance-like variable `g` (both in volts):

```
dv/dt = (v_0 - v + g) / t_mbr      (unless refractory)
dg/dt = -g / tau                   (unless refractory)
spike:  v > v_th and not refractory
reset:  v = v_rst; g = 0           (model.py also writes "w = 0", but a neuron has no variable w: no effect)
synapse (pre -> post): on a presynaptic spike, after t_dly:  g_post += w_pre,post   (skipped if post is refractory)
w_pre,post = (number of synapses pre -> post) x (+1 if pre is excitatory, -1 if inhibitory) x w_syn
```

Integration: `method='linear'`. Brian2 solves the linear system exactly over each step. With
`a = exp(-dt/t_mbr)`, `c = exp(-dt/tau)`:

```
g' = c * g
v' = (v_0 - v_0 * a) + ( C * g + a * v ),     C = tau/(t_mbr - tau) * (e^{dt/tau} - e^{dt/t_mbr}) * a * c = (1/3)(a - c)
```

so one synaptic event of weight w produces the PSP `v(t) - v_0 = w/3 * (e^{-t/20ms} - e^{-t/5ms})` (peak 0.1575 w at
9.2 ms). The resting state (`v = v_0`, `g = 0`) is an exact fixed point of the float64 update (Sterbenz lemma), which is
why skipping resting neurons is exact.

## 3. What happens in one time step (Brian2 schedule)

The generated network runs, for step n (t = n * 0.1 ms), in this order:

1. **groups**: for every neuron, `not_refractory = timestep(t - lastspike) >= timestep(rfc)` where
   `timestep(x) = int((x + 1e-3 dt)/dt)`, so `timestep(2.2 ms) = 22`; then the exact update above, but only for
   non-refractory neurons (refractory neurons keep `v` and `g` frozen).
2. **thresholds**: `v > v_th and not_refractory` -> spike; `lastspike = t`, `not_refractory = False` (immediately).
3. **synapses, pre pathway** (order -1): spikes emitted 18 steps (= 1.8 ms) earlier arrive; for each synapse,
   **`if target.not_refractory: g += w`**. Input to a refractory neuron is lost, including to a neuron that spiked
   in this very step.
4. **synapses, PoissonInput** (order 0): **`if not_refractory: v += weight * binomial(1, rate*dt)`**.
5. **resets**: spiking neurons get `v = v_rst`, `g = 0` (which also wipes any input that arrived in step 3-4).

Consequences that matter for a faithful clone (all tested): a spike at step n reaches its targets at step n + 18 and
first moves their `v` in step n + 19; a neuron is deaf for steps n .. n + 21 and integrates again at step n + 22;
Poisson targets have `rfc = 0` ms, so they are deaf only during the spike step itself.

## 4. Poisson (optogenetic-like) input

`PoissonInput(target=neu[i], target_var='v', N=1, rate=r, weight=w_syn*f_poi)` for each stimulated neuron i, and
`neu[i].rfc = 0 ms`. The weight is 0.275 mV x 250 = **68.75 mV added directly to `v`**, which is +16.75 mV, far above
threshold, so every accepted event makes the neuron spike one step later. With `N = 1` and `r*dt = p < 5`, Brian2's
`BinomialFunction` is an exact Bernoulli(p) draw per step (inverse transform), p = r * 0.1 ms. An event in the step
right after a spike is dropped (the neuron spiked in the previous step, and in that step input is refused), so the
GRNs fire at `r (1 - r dt)`, e.g. 99.0 Hz for 100 Hz, 147.8 Hz for 150 Hz (the authors' output files show 97-100 Hz
for the nominal 100 Hz input).

The two sets of the experiment are `neu_exc` (rate `r_poi`) and `neu_exc2` (rate `r_poi2`).

## 5. Weights

`Connectivity_783.parquet` (FlyWire public materialization 783, built by the authors): 15,091,983 rows, one per
(presynaptic, postsynaptic) neuron pair; `Connectivity` = number of synapses, `Excitatory` = +1/-1 (predicted
neurotransmitter of the presynaptic neuron), `Excitatory x Connectivity` = the signed count used as the weight.
Checked here: the sign is constant per presynaptic neuron (96,672 excitatory, 41,333 inhibitory, 634 without
outputs), no duplicate pairs, no self-connections, 54,492,922 synapses in total, 49.7 % of pairs have a single
synapse, the largest pair has 2,405. It agrees for 95.6 % of neurons with the v783 top-transmitter annotation
(ACh/dopamine/serotonin/octopamine -> +, GABA/glutamate -> -; `results/nt_sign_check.json`). Not modelled: gap
junctions, neuromodulation, plasticity, graded or non-spiking neurons, dendritic structure, per-neuron
parameters, basal firing (all neurons are silent at rest; "baseline 0 Hz").

## 6. The experiments (figures.ipynb) and the IDs

All gustatory experiments activate the labellar GRNs of one side with Poisson input for 1 s, 30 trials each. The
notebooks list **FlyWire v630** root IDs; `reference/conditions.py` holds them verbatim. Between v630 and v783 three of
them changed root ID after proofreading and were re-identified by synaptic-partner similarity
(`tools/map_v630_ids.py`; the new neuron's input+output weight vector has cosine similarity 1.0 / 1.0 / 0.99998 with the
old one, the runner-up 0.42 / 0.34 / 0.28):

| role | v630 ID | v783 ID |
|---|---|---|
| a sugar GRN | 720575940620900446 | 720575940639259967 |
| a bitter GRN | 720575940618600651 | 720575940619072513 |
| MN9 ipsilateral to the stimulated GRNs | 720575940645521262 | 720575940618238523 |

Sets: sugar 21 GRNs, bitter 21, water 18, Ir94e 18; MN9 contralateral = 720575940660219265 (the readout of figures 1,
3, 4: "unless stated, MN9 contralateral to the GRNs activated"). Notes: (i) the v783 annotation labels the paper's
"right" GRN set `side = left` (nerve-entry side) and MN9 ...265 `side = right`, so we say contralateral/ipsilateral;
(ii) 7 of the paper's 18 "water" neurons are annotated sugar GRNs (LB3c) in v783, and the paper's "sugar" list
contains high-salt (LB3d) and LB4b neurons: we reproduce the paper's lists as published.

## 7. Published numbers we compare against

From the paper text (Shiu et al. 2024, open access, PMC11446845), v630: activation of MN9 in 100 % of simulations at
100 Hz sugar; 45 neurons respond at 10 Hz and 455 at 200 Hz (of 127,400); contralateral > ipsilateral MN9; bitter
suppresses the sugar response of MN6/MN9 (strong bitter eliminates it, strong Ir94e does not); water and sugar act
synergistically; 30 trials x 1000 ms. From the authors' shipped spike files (`results/example/sugarR*.parquet`, v630,
30 trials; `reference/compare_authors_v630.py` -> `results/paper_numbers.json`): 100 Hz sugar -> MN9 67.0 +- 6.6 Hz
(contra), 48.6 Hz (ipsi); 404 neurons; 9,636 spikes per trial. The file `sugarR.parquet` was run at 200 Hz (the GRNs fire
at ~198-202 Hz in it; the notebook text says 200 Hz, `model.py` was later changed to a 150 Hz default): MN9 93.3 +- 3.2 Hz,
448 neurons, 17,052 spikes per trial.

## 8. Differences between this project's reference and the paper

* Brian2 2.10.1 (cython target, arm64) instead of 2.5.1; the generated update code is the same expression.
* FlyWire v783 (138,639 neurons, 15.09 M pairs) instead of v630 (127,400 neurons, 14.69 M pairs). Both are run.
* Trials use fresh random seeds; numbers are means over 30 trials, std over trials.
* Our stimulus intensities beyond the paper's grids (e.g. Water 200 Hz as a default) are picked from the
  dose-response in `results/reference/` and are not claims of the paper.
