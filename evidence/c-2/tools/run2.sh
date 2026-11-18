#!/usr/bin/env bash
# run2.sh (tmpfs work copies) BUILD ID TAG [node flags...] : cold index of a fresh copy, fixed project id, peak RSS, link dump
set -uo pipefail
build="$1"; id="$2"; tag="$3"; shift 3
S="$PYM_SCRATCH"; W=/dev/shm/pymtheg-c2; w="$W/$tag/$id"; o="$S/out/$tag"; mkdir -p "$o" "$W/$tag"
rm -rf "$w"; cp -a --reflink=auto "$S/src/$id" "$w"; rm -f "$w/.done"
cd "$w"
node "$build/dist/cli/main.js" init . --name "$id" --format json > "$o/$id.init" 2>&1
mkdir -p -m 700 .pymtheg/rebuildable
node -e '
const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1]);
db.exec("CREATE TABLE IF NOT EXISTS graph_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
db.prepare("INSERT OR IGNORE INTO graph_meta VALUES (?,?)").run("schema","3");
db.prepare("INSERT OR IGNORE INTO graph_meta VALUES (?,?)").run("project","00000000-0000-4000-8000-00000000c002");
db.close();' .pymtheg/rebuildable/graph.sqlite
/usr/bin/time -f '%M %e' -o "$o/$id.time" timeout 7200 node "$@" "$build/dist/cli/main.js" graph index --root . --json > "$o/$id.json" 2> "$o/$id.err" &
tp=$!
# observation only: RSS of the node process against the last progress line, every 2 s
( sleep 1; : > "$o/$id.rss"; while kill -0 $tp 2>/dev/null; do
    p=; for q in $(pgrep -f "main.js graph index" ); do [ "$(readlink /proc/$q/cwd)" = "$w" ] && p=$q; done
    [ -n "$p" ] && echo "$(date +%s) $(awk '/VmRSS/{print $2}' /proc/$p/status 2>/dev/null) $(tail -c 300 "$o/$id.err" | tail -1 | cut -c1-80)" >> "$o/$id.rss"
    sleep 2; done ) &
wait $tp
echo $? > "$o/$id.code"
node "$S/tools/dump.mjs" .pymtheg/rebuildable/graph.sqlite "$o/$id.dump.gz" > "$o/$id.dumpsum" 2>&1
echo "$tag $id code=$(cat $o/$id.code) rss_kib_s=$(cat $o/$id.time | tail -1) $(cat $o/$id.dumpsum)"
