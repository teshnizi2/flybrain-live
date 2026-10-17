"""How many neurons are drawn at a cell body vs at a backbone anchor point -> results/position_stats.json"""
import json
from pathlib import Path
import pandas as pd
ROOT = Path(__file__).resolve().parent.parent
comp = pd.read_csv(ROOT / "data/raw/shiu/Completeness_783.csv", index_col=0)
a = pd.read_csv(ROOT / "data/raw/annot/Supplemental_file1_neuron_annotations.tsv", sep="\t", low_memory=False).set_index("root_id").reindex(comp.index)
has_pos = a.pos_x.notna(); has_soma = a.soma_x.notna()
by = a[has_pos].groupby("super_class").apply(lambda d: pd.Series({"n": len(d), "with_soma": int(d.soma_x.notna().sum())}), include_groups=False)
out = {"n_model_neurons": int(len(a)), "n_annotated_with_position": int(has_pos.sum()), "n_drawn_at_cell_body": int((has_pos & has_soma).sum()),
       "n_drawn_at_backbone_anchor": int((has_pos & ~has_soma).sum()), "n_not_drawn_no_annotation": int((~has_pos).sum()),
       "by_super_class": {k: {"n": int(v.n), "with_soma": int(v.with_soma)} for k, v in by.iterrows()}}
(ROOT / "results/position_stats.json").write_text(json.dumps(out, indent=1))
print(json.dumps({k: v for k, v in out.items() if k != "by_super_class"}))
