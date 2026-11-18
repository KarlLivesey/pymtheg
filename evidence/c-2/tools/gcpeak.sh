#!/usr/bin/env bash
# gcpeak.sh FILE : largest heap size after a full (mark-compact) collection, in MB, from --trace-gc output
grep -o 'Mark-Compact[^,]* -> [0-9.]*' "$1" | awk '{v=$NF+0; if (v>m) m=v} END{printf "%d", m}'
