#!/usr/bin/env bash
# C-8 evidence: source facts for the round-2 hand-check sample (sites whose
# target depends on context). Usage: verify-round2.sh SRC (pinned clones)
set -u
src="$1"
g() { grep -n "$@" | head -4; }
echo "== gin render/render_test.go:390 testdata.Test"
g 'testdata' "$src/gin-gonic__gin/render/render_test.go"
g '^type Test struct' "$src/gin-gonic__gin/testdata/protoexample/test.pb.go"
echo "== cli render.go:302 state.Data.Rows and :526 raster.fonts.Styles"
T="$src/cli__cli/.github/skills/cli-exercise/tool/internal"
sed -n 280,302p "$T/evidence/render.go" | grep -n 'state\b\|state :=\|state,\|raster' | head -5
g 'Data .*TerminalData\|Rows \|^type TerminalData' "$T/recording/models.go"
g 'fonts \|raster \*\|type .*raster' "$T/evidence/"*.go
g '^type Set struct\|Styles ' "$T/fontutil/font.go"
echo "== gopls deprecated.go:181 pass.Pkg"
sed -n 150,181p "$src/golang__tools/gopls/internal/analysis/deprecated/deprecated.go" | grep -n 'pass \*analysis.Pass\|func ' | head -3
g 'Pkg  *\*types.Package' "$src/golang__tools/go/analysis/analysis.go"
echo "== gopls splitpkg/graph.go:18 set.Set"
g 'collection/set"' "$src/golang__tools/gopls/internal/golang/splitpkg/graph.go"
g '^type Set\[' "$src/golang__tools/internal/collection/set/set.go"
echo "== protobuf name_clash_test.go:129 m7.GetBar"
F="$src/protocolbuffers__protobuf-go/cmd/protoc-gen-go/name_clash_test/name_clash_test.go"
sed -n 110,129p "$F" | grep -n 'm7' | head -3
g 'test_name_clash_open"\|nameclash/test_name_clash_open' "$F"
g 'func (x \*M7) GetBar' "$src/protocolbuffers__protobuf-go/cmd/protoc-gen-go/testdata/nameclash/test_name_clash_open/test_name_clash_open.pb.go"
