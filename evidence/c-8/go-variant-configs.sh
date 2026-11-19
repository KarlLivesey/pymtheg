#!/usr/bin/env bash
# C-8 evidence: the two build-variant fixtures of test/graph-go-results.test.mjs
# ("a call through a function declared per build variant"), checked with the go
# command in each configuration: whether the caller's package builds, and which
# files Go selects.
# Usage: go-variant-configs.sh WORK (a new, empty directory)
set -u
work="$1"
export GOFLAGS=-mod=readonly GOPROXY=off GOWORK=off GOTOOLCHAIN=local CGO_ENABLED=0
put() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; }
show() {
  local label="$1"; shift
  local files
  files=$(env "$@" go list -f '{{.GoFiles}}' ./p 2>&1 | tr '\n' ' ')
  if env "$@" go build ./p > /dev/null 2> "$work/err"; then
    echo "$label: builds; files $files"
  else
    echo "$label: does not build ($(head -1 "$work/err")); files $files"
  fi
}

# (a) A caller built on linux or darwin; New only on linux and windows.
mkdir -p "$work/coverage" && cd "$work/coverage" || exit 1
put go.mod "module example.com/coverage

go 1.22"
put p/new_linux.go "package p

func New() *T { return &T{} }"
put p/new_windows.go "package p

func New() *T { return &T{} }"
put p/t_linux.go "package p

type T struct{}

func (*T) M() {}"
put p/t_windows.go "package p

type T struct{}

func (*T) M() {}"
put p/t_darwin.go "package p

type T struct{}

func (*T) M() {}"
put p/use.go "//go:build linux || darwin

package p

func Use() { New().M() }"
echo "== (a) coverage"
show "GOOS=linux" GOOS=linux GOARCH=amd64
show "GOOS=darwin" GOOS=darwin GOARCH=arm64
show "GOOS=windows" GOOS=windows GOARCH=amd64

# (b) Two linux builds that differ by a tag named like a GOOS.
mkdir -p "$work/tags" && cd "$work/tags" || exit 1
put go.mod "module example.com/tags

go 1.22"
put p/new_a.go "//go:build linux && !freebsd

package p

func New() *A { return &A{} }"
put p/new_b.go "//go:build linux && freebsd

package p

func New() *B { return &B{} }"
put p/types.go "package p

type A struct{}

func (*A) M() {}

type B struct{}

func (*B) M() {}"
put p/use_linux.go "package p

func Use() { New().M() }"
echo "== (b) tags"
show "GOOS=linux" GOOS=linux GOARCH=amd64
show "GOOS=linux -tags=freebsd" GOOS=linux GOARCH=amd64 GOFLAGS="-mod=readonly -tags=freebsd"
