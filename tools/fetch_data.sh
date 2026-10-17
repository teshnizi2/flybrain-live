#!/bin/bash
# Download the upstream inputs into data/raw/ (gitignored). Licences: model/connectivity MIT (philshiu),
# FlyWire annotations CC-BY 4.0 (Dorkenwald et al. 2024; Schlegel et al. 2024).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw/shiu data/raw/shiu630 data/raw/annot data/raw/shiu/results_example
S=https://github.com/philshiu/Drosophila_brain_model/raw/main
for f in model.py utils.py example.ipynb figures.ipynb Readme.md LICENSE environment.yml sez_neurons.pickle Completeness_783.csv Connectivity_783.parquet; do
  [ -s data/raw/shiu/$f ] || curl -sL -o data/raw/shiu/$f $S/$f
done
for f in sugarR.parquet sugarR_100Hz.parquet; do
  [ -s data/raw/shiu/results_example/$f ] || curl -sL -o data/raw/shiu/results_example/$f $S/results/example/$f
done
# v630 files: only used to (a) map the three v630 IDs that changed in v783 and (b) validate against the authors' shipped v630 outputs
for f in 2023_03_23_connectivity_630_final.parquet 2023_03_23_completeness_630_final.csv; do
  [ -s data/raw/shiu630/$f ] || curl -sL -o data/raw/shiu630/$f $S/$f
done
[ -s data/raw/annot/Supplemental_file1_neuron_annotations.tsv ] || curl -sL -o data/raw/annot/Supplemental_file1_neuron_annotations.tsv \
  https://github.com/flyconnectome/flywire_annotations/raw/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv
shasum -a 256 data/raw/shiu/Connectivity_783.parquet data/raw/shiu/Completeness_783.csv data/raw/shiu/model.py \
  data/raw/annot/Supplemental_file1_neuron_annotations.tsv > data/raw/CHECKSUMS.sha256
cat data/raw/CHECKSUMS.sha256
