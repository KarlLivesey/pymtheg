#!/usr/bin/env bash
# R1-D real run on a copy of the pinned restic corpus (dev server).
# Usage (from the worktree): pymtheg-dev --name NAME -- bash evidence/r1-d/restic-run.sh
set -u
P="node $PWD/dist/cli/main.js"
R=$PYM_SCRATCH/restic
# Fresh copy each run, so the script replays from the pinned corpus.
rm -rf "$R";
[ -d "$R/.pymtheg" ] || { rm -rf "$R"; cp -r ~/pymtheg-dev/corpora/restic "$R"; chmod -R u+w "$R"; (cd "$R" && $P init . --format json >/dev/null); }
cd "$R"
run() { echo "\$ pymtheg $*"; $P "$@"; echo "[exit $?]"; echo; }
run link requirement R-PACK --title "Blobs are packed before upload" --text "Saving a blob adds it to an open pack file."
run link requirement R-INDEX --title "Repository index loads on open"
run link requirement R-FORGET --title "Forget applies the retention policy"
run link add R-INDEX LoadIndex
run link add R-INDEX "(*Repository).LoadIndex"
run link add R-PACK internal/repository/packer_manager.go:116
run link add R-FORGET runForget
run link check
echo "# edit: add a statement to the body of (*packerManager).SaveBlob"
sed -i '116,149{s/^\(\t\)\(if \)/\1_ = 0 \/\/ r1-d edit\n\1\2/;}' internal/repository/packer_manager.go
sed -n '116,122p' internal/repository/packer_manager.go
echo
run link check
run link touched "(*Repository).LoadIndex" --impact --depth 2
run link unlinked
echo "# round-1 review case: rename splitPath (internal/filter) and PruneOptions (internal/repository);"
echo "# each has a same-named symbol in cmd/restic, which must not become the link target."
run link requirement R-FILTER --title "Exclude patterns split paths into components"
run link requirement R-PRUNEOPT --title "Prune options are validated"
pick() { $P link add "$1" "$2" --json | node -e 'const r=JSON.parse(require("fs").readFileSync(0));const m=r.matches.find(m=>m.path.startsWith(process.argv[1]));process.stdout.write(m?m.graphId:"none")' "$3"; }
run link add R-FILTER splitPath
run link add R-FILTER "$(pick R-FILTER splitPath internal/filter)"
run link add R-PRUNEOPT "$(pick R-PRUNEOPT PruneOptions internal/repository)"
F=$(grep -l "^func splitPath" internal/filter/*.go | head -1)
G=$(grep -l "^type PruneOptions" internal/repository/*.go | head -1)
echo "# edit: rename splitPath -> splitPathRenamed in $F; PruneOptions -> PruneOptionsRenamed in $G"
sed -i 's/\bsplitPath\b/splitPathRenamed/g' "$F"
sed -i 's/\bPruneOptions\b/PruneOptionsRenamed/g' "$G"
echo
run link check
run link refresh "$($P link list --record R-FILTER --json | node -e 'const r=JSON.parse(require("fs").readFileSync(0));process.stdout.write(r.links[0].link.id)')"
run link history
