"""Generate oracle fixtures for the JS engine tests from the authors' Brian2 model (unmodified model.py).

Each fixture is a small random network + a schedule of Poisson-style input events, run in Brian2 for
n_steps with dt = 0.1 ms. The JS engine must reproduce the spike trains exactly and the state traces to
float64 round-off. Input events are injected in the same scheduling slot as Brian2's PoissonInput
('synapses', order 0, skipped for refractory targets), but taken from an explicit list so the stochastic
part is identical in both implementations.

  python tests/fixtures/make_fixtures.py     ->  tests/fixtures/*.json
"""
import json, sys
from collections import defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "data/raw/shiu"))
import numpy as np
from brian2 import *
prefs.codegen.target = "cython"
from model import default_params as P

DT = 0.1 * ms


def brian_run(N, pre, post, cnt, events, n_steps, rfc_zero, trace_ids):
    """pre/post/cnt: arrays (signed integer counts). events: list of (step, neuron)."""
    start_scope()
    defaultclock.dt = DT
    neu = NeuronGroup(N, model=P["eqs"], method="linear", threshold=P["eq_th"], reset=P["eq_rst"],
                      refractory="rfc", name="default_neurons", namespace=P)
    neu.v = P["v_0"]; neu.g = 0; neu.rfc = P["t_rfc"]
    for i in rfc_zero:
        neu[i].rfc = 0 * ms
    syn = Synapses(neu, neu, "w : volt", on_pre="g += w", delay=P["t_dly"], name="default_synapses")
    syn.connect(i=np.asarray(pre), j=np.asarray(post))
    syn.w = np.asarray(cnt) * P["w_syn"]
    mon = SpikeMonitor(neu)
    ev = defaultdict(list)
    for s, i in events:
        ev[int(s)].append(int(i))
    counter = [0]
    notref = neu.variables["not_refractory"].get_value
    vv = neu.variables["v"].get_value
    gg = neu.variables["g"].get_value
    trace = {int(i): {"v": [], "g": []} for i in trace_ids}
    weight = float(P["w_syn"] * P["f_poi"])  # same quantity the PoissonInput uses

    @network_operation(when="start", order=1)
    def record():
        v = vv(); g = gg()
        for i in trace:
            trace[i]["v"].append(float(v[i])); trace[i]["g"].append(float(g[i]))

    @network_operation(when="synapses", order=1)   # after default_synapses_pre (order -1), like PoissonInput (order 0)
    def inject():
        s = counter[0]
        for i in ev.get(s, ()):
            if notref()[i]:
                vv()[i] += weight
        counter[0] += 1

    net = Network(neu, syn, mon, record, inject)
    net.run(n_steps * DT)
    spikes = sorted((int(round(float(t) / float(DT))), int(i)) for i, t in zip(mon.i[:], mon.t[:]))
    return spikes, trace


def make_net(rng, N, density, cnt_scale, frac_inh=0.3, big_prob=0.02):
    sign = np.where(rng.random(N) < frac_inh, -1, 1)
    pre, post = np.nonzero(rng.random((N, N)) < density)
    keep = pre != post
    pre, post = pre[keep], post[keep]
    cnt = np.maximum(1, np.round(rng.lognormal(mean=np.log(cnt_scale), sigma=0.9, size=len(pre)))).astype(int)
    cnt = np.where(rng.random(len(pre)) < big_prob, cnt * 8, cnt)
    cnt = cnt * sign[pre]
    return pre, post, cnt


def make_events(rng, driver_ids, rate_hz, n_steps):
    p = rate_hz * 1e-4
    ev = []
    for d in driver_ids:
        steps = np.nonzero(rng.random(n_steps) < p)[0]
        ev += [(int(s), int(d)) for s in steps]
    return sorted(ev)


SCENARIOS = {
    # name: (seed, N, density, count scale, n_drivers, rate Hz, n_steps)
    "micro_chain":  None,   # hand-built below
    "small_a": (11, 120, 0.10, 14, 6, 200, 6000),
    "small_b": (23, 300, 0.05, 20, 10, 250, 8000),
    "small_c": (37, 200, 0.12, 9, 8, 300, 8000),    # weaker synapses, more summation
}


def build(name):
    if name == "micro_chain":
        # 0 (driver, rfc 0) -> 1 (+300, fires from one spike) -> 2 (+300) ; 1 -> 3 (-300) ; 2 -> 3 (+40); 0 -> 4 (+60 small)
        # 5 gets both an excitatory and an inhibitory spike in the same step; events include a double event step and
        # an event landing during the refractory window of neuron 1's forced firing.
        N = 6
        pre = [0, 1, 1, 2, 0, 0, 2]; post = [1, 2, 3, 3, 4, 5, 5]; cnt = [300, 300, -300, 40, 60, 25, -25]
        events = [(10, 0), (40, 0), (41, 0), (100, 0), (150, 0), (151, 0), (152, 0), (400, 0), (401, 0), (402, 0), (403, 0), (404, 0)]
        n_steps = 700
        return dict(N=N, pre=pre, post=post, cnt=cnt, events=events, n_steps=n_steps, rfc_zero=[0], trace_ids=[0, 1, 2, 3, 4, 5])
    seed, N, dens, scale, nd, rate, n_steps = SCENARIOS[name]
    rng = np.random.default_rng(seed)
    pre, post, cnt = make_net(rng, N, dens, scale)
    drivers = list(range(nd))
    events = make_events(rng, drivers, rate, n_steps)
    return dict(N=N, pre=pre.tolist(), post=post.tolist(), cnt=cnt.tolist(), events=events, n_steps=n_steps,
                rfc_zero=drivers, trace_ids=[0, nd, nd + 1, nd + 2, N - 1])


if __name__ == "__main__":
    out = Path(__file__).resolve().parent
    for name in SCENARIOS:
        spec = build(name)
        spikes, trace = brian_run(**spec)
        fixture = {
            "name": name, "N": spec["N"], "n_steps": spec["n_steps"], "rfc_zero": spec["rfc_zero"],
            "pre": spec["pre"], "post": spec["post"], "cnt": spec["cnt"], "events": spec["events"],
            "spikes": spikes, "trace_ids": spec["trace_ids"], "trace": {str(k): v for k, v in trace.items()},
            "brian2_version": __import__("brian2").__version__,
        }
        (out / f"{name}.json").write_text(json.dumps(fixture))
        by = defaultdict(int)
        for _, i in spikes: by[i] += 1
        print(f"{name}: N={spec['N']} edges={len(spec['pre'])} events={len(spec['events'])} spikes={len(spikes)} "
              f"neurons_spiking={len(by)}")
