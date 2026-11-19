#!/usr/bin/env bash
# C-8 evidence: how the go command resolves imports in the shapes the
# resolver models. Each case builds a tiny module offline and prints whether
# `go build` succeeds and, when it does, which package was used (each
# candidate package's function returns a different number).
# Usage: go-import-rules.sh WORK (a new, empty directory)
set -u
work="$1"
# The default -mod=readonly: go may not edit go.mod to make a case build.
export GOFLAGS=-mod=readonly GOPROXY=off GOWORK=off GOTOOLCHAIN=local
case_dir() { mkdir -p "$work/$1"; cd "$work/$1" || exit 1; }
put() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; }
run() {
  echo "== $1"
  if go build -o "$work/bin-$1" ./cmd > "$work/out-$1" 2>&1; then
    echo "builds; uses package returning $("$work/bin-$1")"
  else
    echo "fails: $(head -2 "$work/out-$1" | tr '\n' ' ')"
  fi
}
main_using() { put cmd/main.go "package main

import (
	\"fmt\"

	p \"$1\"
)

func main() { fmt.Println(p.F()) }"; }

# 1. replace without require (go 1.22).
case_dir no-require
put go.mod "module example.com/app

go 1.22

replace example.com/dep => ./dep"
put dep/go.mod "module example.com/dep

go 1.22"
put dep/d.go "package dep
func F() int { return 1 }"
main_using example.com/dep
run no-require

# 2. the main module provides testdata/p; an unrequired replace of that path does nothing.
case_dir testdata-unused-replace
put go.mod "module example.com/app

go 1.22

replace example.com/app/testdata/p => ./testdata/dep"
put testdata/p/p.go "package p
func F() int { return 1 }"
put testdata/dep/go.mod "module example.com/app/testdata/p

go 1.22"
put testdata/dep/p.go "package p
func F() int { return 2 }"
main_using example.com/app/testdata/p
run testdata-unused-replace

# 3. the same with the replaced module required: two modules provide the package.
case_dir testdata-required-replace
put go.mod "module example.com/app

go 1.22

require example.com/app/testdata/p v0.0.0

replace example.com/app/testdata/p => ./testdata/dep"
put testdata/p/p.go "package p
func F() int { return 1 }"
put testdata/dep/go.mod "module example.com/app/testdata/p

go 1.22"
put testdata/dep/p.go "package p
func F() int { return 2 }"
main_using example.com/app/testdata/p
run testdata-required-replace

# 4. replace => .. where the parent has no go.mod.
case_dir parent-without-gomod
mkdir -p inner
put lib/l.go "package lib
func F() int { return 1 }"
cd inner || exit 1
put go.mod "module example.com/app

go 1.22

require example.com/parent v0.0.0

replace example.com/parent => .."
main_using example.com/parent/lib
run parent-without-gomod

# 5. replace => .. where the parent's go.mod declares the replaced path.
case_dir parent-with-gomod
put go.mod "module example.com/parent

go 1.22"
put lib/l.go "package lib
func F() int { return 1 }"
cd "$work/parent-with-gomod" && mkdir -p inner && cd inner || exit 1
put go.mod "module example.com/app

go 1.22

require example.com/parent v0.0.0

replace example.com/parent => .."
main_using example.com/parent/lib
run parent-with-gomod

# 6. replace => a directory whose go.mod declares another path.
case_dir path-mismatch
put go.mod "module example.com/app

go 1.22

require example.com/dep v0.0.0

replace example.com/dep => ./dep"
put dep/go.mod "module example.com/other

go 1.22"
put dep/d.go "package dep
func F() int { return 1 }"
main_using example.com/dep
run path-mismatch

# 7. a package whose only file is //go:build ignore.
case_dir ignore-only
put go.mod "module example.com/app

go 1.22"
put p/p.go "//go:build ignore

package p
func F() int { return 1 }"
main_using example.com/app/p
run ignore-only

# 8. an unpruned main module (go 1.16) with a replace and no require.
case_dir unpruned-no-require
put go.mod "module example.com/app

go 1.16

replace example.com/dep => ./dep"
put dep/go.mod "module example.com/dep

go 1.16"
put dep/d.go "package dep
func F() int { return 1 }"
main_using example.com/dep
run unpruned-no-require
