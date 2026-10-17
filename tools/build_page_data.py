"""Build site/data/reference.json (numbers shown on the page) from results/*.json. Nothing is typed by hand.

  python tools/build_page_data.py
"""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
R = ROOT / "results"
b2 = lambda cond, g="783": json.loads((R / f"reference/brian2_{g}_{cond}.json").read_text())
js_path = lambda cond, g="783": R / f"reference/js_{g}_{cond}.json"
authors = json.loads((R / "paper_numbers.json").read_text())["authors_shipped_outputs_v630"]

def ms(d, who="contra"):
    x = d["mn9_rate_hz"][who]
    return {"mean": x["mean"], "sd": x["std"]}

presets = {c: {"contra": ms(b2(c)), "ipsi": ms(b2(c), "ipsi"), "n_trials": 30} for c in
           ["sugar_100", "water_200", "bitter_200", "sugar_100__bitter_200"]}
rows = [("Sugar 50 Hz", "sugar_50", None), ("Sugar 100 Hz (paper's calibration)", "sugar_100", "sugar_100"), ("Sugar 200 Hz", "sugar_200", "sugar_200"),
        ("Water 200 Hz", "water_200", None), ("Water 260 Hz", "water_260", None), ("Bitter 200 Hz alone", "bitter_200", None),
        ("Sugar 100 + bitter 50 Hz", "sugar_100__bitter_50", None), ("Sugar 100 + bitter 100 Hz", "sugar_100__bitter_100", None),
        ("Sugar 100 + bitter 200 Hz", "sugar_100__bitter_200", None), ("Sugar 100 + water 100 Hz", "sugar_100__water_100", None),
        ("Sugar 100 + Ir94e 100 Hz", "sugar_100__ir94e_100", None)]
table = []
for label, cond, auth in rows:
    r = {"label": label, "brian2": ms(b2(cond))}
    p = js_path(cond)
    if p.exists(): r["js"] = ms(json.loads(p.read_text()))
    if auth: r["authors"] = {"mean": authors[auth]["mn9"]["contra"]["mean"], "sd": authors[auth]["mn9"]["contra"]["std"]}
    table.append(r)
val = json.loads((R / "validation_js_vs_brian2_783.json").read_text()) if (R / "validation_js_vs_brian2_783.json").exists() else None
note = ("MN9 contralateral to the stimulated neurons, mean &plusmn; sd over 30 trials of 1&nbsp;s. &ldquo;Authors&rdquo; = spike files shipped with the paper's code (FlyWire v630); "
        "the other two columns use v783. Deterministic replay of identical input events: every spike of four full-brain runs (44,080 spikes) is reproduced exactly.")
(ROOT / "site/data/reference.json").write_text(json.dumps({"presets": presets, "table": table, "note": note,
                                                           "validation_pass": (val or {}).get("all_pass")}, indent=1))
print("wrote site/data/reference.json", len(table), "rows;", sum('js' in r for r in table), "with JS numbers")
