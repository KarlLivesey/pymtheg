#!/usr/bin/env bash
# C-6 store compatibility across builds: pymtheg@0.1.0 (npm), main (<main>
# tree with dist) and this branch (<branch> tree with dist), on a small copy
# of restic's internal/restic package. Prints one line per step.
#   bash evidence/c-6/compat.sh <main-tree> <branch-tree>
set -uo pipefail
main=$(realpath "$1")/dist/cli/main.js
branch=$(realpath "$2")/dist/cli/main.js
# Fresh folders per run and per project; the scratch folder is removed by --clean.
S=${PYM_SCRATCH:?}; C="$S/compat-$(date +%s%N)"; n=0
mkdir -p "$C/v010"
(cd "$C/v010" && npm init -y >/dev/null && npm i --ignore-scripts --no-audit --no-fund pymtheg@0.1.0 >/dev/null 2>&1)
old="$C/v010/node_modules/pymtheg/dist/cli/main.js"
fresh() { n=$((n + 1)); P="$C/p$n"; db="$P/.pymtheg/rebuildable/graph.sqlite"; mkdir -p "$P"; cp -r ~/pymtheg-dev/corpora/restic/internal/restic "$P/"; cp ~/pymtheg-dev/corpora/restic/go.mod "$P/"; chmod -R u+w "$P"; (cd "$P" && node "$old" init . --name compat >/dev/null 2>&1); }
step() { # label cli args...
  local label="$1" cli="$2"; shift 2
  local out; out=$(cd "$P" && node "$cli" "$@" --json 2>"$C/err")
  local code=$?
  local summary; summary=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);console.log(r.error ? "status="+r.status+" message="+JSON.stringify(r.error.message ?? r.error) : "status="+r.status+" complete="+r.sync?.complete+" files="+r.counts?.files+" links="+r.counts?.links)}catch{console.log("error: "+require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").filter(l=>!/Experimental|trace-warnings/.test(l)).slice(-1)[0])}})' "$C/err")
  local fmt; fmt=$(node -e 'const b=require("fs").readFileSync(process.argv[1]);console.log(b[18]+","+b[19])' "$db" 2>/dev/null)
  echo "$label: exit=$code $summary format=$fmt files=$(ls "$(dirname "$db")" | tr '\n' ' ')"
}
killed() { # cli : start a cold index and SIGKILL it once the log holds commits
  (cd "$P" && exec node "$1" graph index --json >/dev/null 2>&1) & local pid=$!
  while kill -0 $pid 2>/dev/null; do
    s=$(stat -c %s "$db-wal" 2>/dev/null || echo 0)
    [ "$s" -gt 500000 ] && { kill -9 $pid; break; }
    sleep 0.05
  done
  wait $pid 2>/dev/null
  echo "killed-index: wal-bytes=$(stat -c %s "$db-wal" 2>/dev/null || echo none)"
}
echo "== 0.1.0 store, then this branch, then 0.1.0 again"
fresh
step "0.1.0 index" "$old" graph index
step "branch status on 0.1.0 store" "$branch" graph status
step "branch index (upgrade)" "$branch" graph index
step "0.1.0 status on upgraded store" "$old" graph status
step "main status on branch store" "$main" graph status
step "main index on branch store" "$main" graph index
step "branch index on main store" "$branch" graph index
echo "== main store, then this branch"
fresh
step "main index" "$main" graph index
step "branch status on main store" "$branch" graph status
echo "== a branch index killed with its log in place"
fresh
killed "$branch"
step "0.1.0 status on killed store" "$old" graph status
step "main status on killed store" "$main" graph status
step "branch status on killed store" "$branch" graph status
step "main index repairs" "$main" graph index
fresh
killed "$branch"
step "branch index repairs" "$branch" graph index
echo compat done
