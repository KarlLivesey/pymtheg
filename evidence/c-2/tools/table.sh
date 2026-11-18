#!/usr/bin/env bash
# table.sh BASETAG CANDTAG : per repository outcome, peak RSS, wall time, peak per 1,000 files, dump digest equality
cd "$PYM_SCRATCH/out"
printf "| Repository | Files indexed | Before: exit · peak MiB · s | After: exit · peak MiB · s | Peak MiB per 1,000 files, before → after | Stored records identical |\n|---|--:|---|---|---|---|\n"
for id in $(cat "$PYM_SCRATCH/tools/order.txt"); do
  b="$1/$id"; c="$2/$id"; [ -s "$c.code" ] || continue
  files=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").split("\n").find((l)=>l.startsWith("{")));console.log(r.sync?.report?.claimed ?? "")}catch{console.log("")}' "$c.json")
  peak() { awk 'END{printf "%d", $1/1024}' "$1"; }
  secs() { awk 'END{printf "%.0f", $2}' "$1"; }
  pb=$(peak "$b.time"); pc=$(peak "$c.time")
  per=$(awk -v a="$pb" -v b="$pc" -v f="$files" 'BEGIN{printf "%d → %d", a*1000/f, b*1000/f}')
  db=$(awk '{print $NF}' "$b.dumpsum" 2>/dev/null); dc=$(awk '{print $NF}' "$c.dumpsum" 2>/dev/null)
  bc=$(cat "$b.code"); same="yes"
  [ "$db" = "$dc" ] || same="no"
  [ "$bc" = 134 ] && same="n/a (before ran out of heap)"
  echo "| $id | $files | $bc · $pb · $(secs $b.time) | $(cat $c.code) · $pc · $(secs $c.time) | $per | $same |"
done
