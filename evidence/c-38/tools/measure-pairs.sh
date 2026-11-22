#!/usr/bin/env bash
# measure-pairs.sh BUILD:LABEL:REPO... : measure.sh's work for several
# (build, label, pin) triples at once, builds named under $PYM_SCRATCH.
set -u
for triple in "$@"; do
  IFS=: read -r build label id <<< "$triple"
  name="${id//\//_}"
  mkdir -p "$PYM_SCRATCH/out/$label"
  node scripts/reindex/measure.mjs "$PYM_SCRATCH/$build/dist" "$PYM_SCRATCH" "$id" "$PYM_SCRATCH/out/$label/$label-$name" --profile body > "$PYM_SCRATCH/out/$label/$name.log" 2>&1 &
done
wait
for triple in "$@"; do
  IFS=: read -r build label id <<< "$triple"
  grep -E "comment:|body:|export:|equals cold" "$PYM_SCRATCH/out/$label/${id//\//_}.log" | cut -c1-160
done
