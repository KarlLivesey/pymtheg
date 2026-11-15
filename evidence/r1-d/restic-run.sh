#!/usr/bin/env bash
# R1-D real run on a copy of the pinned restic corpus (dev server).
# Usage (from the worktree): pymtheg-dev --name NAME -- bash evidence/r1-d/restic-run.sh
set -u
P="node $PWD/dist/cli/main.js"
R=$PYM_SCRATCH/restic
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
run link history
