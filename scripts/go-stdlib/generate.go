// SPDX-License-Identifier: MIT

//go:build ignore

// generate: the Go module's standard-library API table (C-17). A developer
// step, run with the pinned Go release; the shipped product never needs Go.
//
//	go build -o gen generate.go
//	./gen -out ../../src/graph/languages/go/stdlib/table.txt.gz
//
// For every platform `go tool dist list` names, the generator re-runs itself
// with that GOOS/GOARCH (cgo off) and type-checks every importable standard
// package from GOROOT's source with go/types (`-dump`). The table keeps only
// what is identical on every platform; a member that differs, or exists on
// some platforms only, is recorded as uncertain ("?"), and a package-level
// object that differs is left out. Each member carries the first Go release
// that has it, from GOROOT/api (the file the Go project keeps of its API):
// the resolver uses a member only when that release is no later than the
// project's `go` directive.
//
// The table holds API facts only (names, kinds, declaring owners, embedding
// depths, result and field types), no source text.
//
// Format: tab-separated lines, gzip-compressed.
//
//	#	header	go-version	platforms
//	P	path                                      a package; lines below belong to it
//	T	Name	kind	since                       a named type (kind s struct, i interface, n other)
//	A	Name	target                            a type alias of a named type (target: path.Name)
//	m	Name	owner	depth	since	result...     a method in the type's method set
//	f	Name	owner	depth	since	type          a field (promoted ones too)
//	?	Name	depth                             a member that is uncertain at this depth
//	F	Name	since	result...                  an exported function
//	V	Name	since	type                       an exported variable or typed constant
//
// owner: "=" the type itself, "Type" a type of the same package, else
// "path.Type". Types: "path.Name;" a named type (generic types by their
// origin), "*T" pointer, "[T" slice or array, "MKV" map, "CT" channel, "?"
// anything else (basic types, functions, type parameters, literals).
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"flag"
	"fmt"
	"go/importer"
	"go/token"
	"go/types"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

func main() {
	dump := flag.Bool("dump", false, "print this platform's raw lines (internal)")
	out := flag.String("out", "", "the table file to write (gzip)")
	jobs := flag.Int("jobs", 6, "platforms dumped at once")
	flag.Parse()
	if *dump {
		dumpPlatform()
		return
	}
	if *out == "" {
		fail("-out is required")
	}
	self, err := os.Executable()
	check(err)
	list, err := exec.Command("go", "tool", "dist", "list").Output()
	check(err)
	platforms := strings.Fields(string(list))
	version, err := exec.Command("go", "env", "GOVERSION").Output()
	check(err)
	dumps := make([]map[string]string, len(platforms))
	var wg sync.WaitGroup
	sem := make(chan bool, *jobs)
	for i, platform := range platforms {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- true
			defer func() { <-sem }()
			parts := strings.SplitN(platform, "/", 2)
			cmd := exec.Command(self, "-dump")
			cmd.Env = append(os.Environ(), "GOOS="+parts[0], "GOARCH="+parts[1], "CGO_ENABLED=0")
			var stderr bytes.Buffer
			cmd.Stderr = &stderr
			b, err := cmd.Output()
			if err != nil {
				fail(platform + ": " + err.Error() + "\n" + stderr.String())
			}
			lines := map[string]string{}
			for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
				key, value, _ := strings.Cut(line, "\x00")
				lines[key] = value
			}
			dumps[i] = lines
		}()
	}
	wg.Wait()
	since := apiSince(strings.TrimSpace(goEnv("GOROOT")))
	merged := merge(dumps)
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "#\tpymtheg-go-stdlib-1\t%s\t%d\n", strings.TrimSpace(string(version)), len(platforms))
	stats := map[string]int{}
	for _, item := range merged {
		line := item.value
		fields := strings.Split(line, "\t")
		switch fields[0] {
		case "T", "F", "V":
			fields = insertSince(fields, since.of(item.pkg, sinceKey(fields)))
		case "m", "f":
			fields = insertSince(fields, since.member(item.pkg, item.typ, fields))
		}
		stats[fields[0]]++
		buf.WriteString(strings.Join(fields, "\t"))
		buf.WriteByte('\n')
	}
	var gz bytes.Buffer
	w, err := gzip.NewWriterLevel(&gz, gzip.BestCompression)
	check(err)
	w.Write(buf.Bytes())
	check(w.Close())
	check(os.WriteFile(*out, gz.Bytes(), 0o644))
	fmt.Fprintf(os.Stderr, "%s, %d platforms: packages %d, types %d, aliases %d, methods %d, fields %d, uncertain %d, functions %d, values %d; %d bytes, %d gzip\n",
		strings.TrimSpace(string(version)), len(platforms), stats["P"], stats["T"], stats["A"], stats["m"], stats["f"], stats["?"], stats["F"], stats["V"], buf.Len(), gz.Len())
}

func goEnv(name string) string {
	b, err := exec.Command("go", "env", name).Output()
	check(err)
	return string(b)
}

// ---- one platform ---------------------------------------------------------

// The raw lines of one platform: "key\x00line", where the key orders the
// table (package, then type, then member) and identifies an entry across
// platforms.
func dumpPlatform() {
	list, err := exec.Command("go", "list", "std").Output()
	check(err)
	fset := token.NewFileSet()
	imp := importer.ForCompiler(fset, "source", nil)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	emit := func(key, line string) { fmt.Fprintf(w, "%s\x00%s\n", key, line) }
	emit("builtin", "P\tbuiltin")
	emit("builtin\x01error", "T\terror\ti")
	emit("builtin\x01error\x01Error", "m\tError\t=\t0\t?")
	for _, path := range strings.Fields(string(list)) {
		if !importable(path) {
			continue
		}
		p, err := imp.Import(path)
		if err != nil {
			continue // not on this platform
		}
		emit(path, "P\t"+path)
		scope := p.Scope()
		for _, name := range scope.Names() {
			obj := scope.Lookup(name)
			if !obj.Exported() {
				continue
			}
			key := path + "\x01" + name
			switch obj := obj.(type) {
			case *types.Func:
				emit(key, "F\t"+name+results(obj.Type().(*types.Signature)))
			case *types.Var:
				emit(key, "V\t"+name+"\t"+enc(obj.Type()))
			case *types.Const:
				if _, ok := obj.Type().(*types.Named); ok {
					emit(key, "V\t"+name+"\t"+enc(obj.Type()))
				}
			case *types.TypeName:
				if obj.IsAlias() {
					if named, ok := types.Unalias(obj.Type()).(*types.Named); ok && named.Obj().Pkg() != nil {
						emit(key, "A\t"+name+"\t"+named.Obj().Pkg().Path()+"."+named.Origin().Obj().Name())
					}
					continue
				}
				named, ok := obj.Type().(*types.Named)
				if !ok {
					continue
				}
				kind := "n"
				switch named.Underlying().(type) {
				case *types.Struct:
					kind = "s"
				case *types.Interface:
					kind = "i"
				}
				emit(key, "T\t"+name+"\t"+kind)
				for _, member := range members(named) {
					emit(key+"\x01"+member.name, member.line)
				}
			}
		}
	}
}

// importable: a package another module may import.
func importable(path string) bool {
	for _, part := range strings.Split(path, "/") {
		if part == "internal" {
			return false
		}
	}
	return !strings.HasPrefix(path, "vendor/") && !strings.HasPrefix(path, "cmd/") && path != "unsafe"
}

type member struct{ name, line string }

// members: every exported field and method selectable on a value of the
// named type, with its declaring owner and depth (Go's selector rule as
// go/types applies it), and names that are ambiguous at their depth.
func members(named *types.Named) []member {
	pkg := named.Obj().Pkg()
	names := map[string]int{} // name -> shallowest depth it occurs at
	if types.IsInterface(named) {
		ms := types.NewMethodSet(named)
		for i := 0; i < ms.Len(); i++ {
			if ms.At(i).Obj().Exported() {
				names[ms.At(i).Obj().Name()] = 0
			}
		}
	} else {
		ms := types.NewMethodSet(types.NewPointer(named))
		for i := 0; i < ms.Len(); i++ {
			if obj := ms.At(i).Obj(); obj.Exported() {
				names[obj.Name()] = len(ms.At(i).Index()) - 1
			}
		}
		// Fields, and every method name on any embedded type (an ambiguous
		// method is in no method set): breadth first over the embedding.
		type node struct {
			t     types.Type
			depth int
		}
		seen := map[types.Type]bool{}
		level := []node{{named, 0}}
		for len(level) > 0 {
			var next []node
			for _, n := range level {
				t := n.t
				if pt, ok := t.(*types.Pointer); ok {
					t = pt.Elem()
				}
				t = types.Unalias(t)
				if seen[t] {
					continue
				}
				seen[t] = true
				if nt, ok := t.(*types.Named); ok && n.depth > 0 {
					for i := 0; i < nt.NumMethods(); i++ {
						if m := nt.Method(i); m.Exported() {
							if d, ok := names[m.Name()]; !ok || n.depth < d {
								names[m.Name()] = n.depth
							}
						}
					}
					if iface, ok := nt.Underlying().(*types.Interface); ok {
						for i := 0; i < iface.NumMethods(); i++ {
							if m := iface.Method(i); m.Exported() {
								if d, ok := names[m.Name()]; !ok || n.depth < d {
									names[m.Name()] = n.depth
								}
							}
						}
					}
				}
				st, ok := t.Underlying().(*types.Struct)
				if !ok {
					continue
				}
				for i := 0; i < st.NumFields(); i++ {
					f := st.Field(i)
					if f.Exported() {
						if d, ok := names[f.Name()]; !ok || n.depth < d {
							names[f.Name()] = n.depth
						}
					}
					if f.Embedded() {
						next = append(next, node{f.Type(), n.depth + 1})
					}
				}
			}
			level = next
		}
	}
	var out []member
	for name, depth := range names {
		obj, index, _ := types.LookupFieldOrMethod(named, true, pkg, name)
		if obj == nil {
			out = append(out, member{name, fmt.Sprintf("?\t%s\t%d", name, depth)})
			continue
		}
		d := len(index) - 1
		switch obj := obj.(type) {
		case *types.Var:
			owner := ownerName(fieldHolder(named, index), pkg)
			out = append(out, member{name, fmt.Sprintf("f\t%s\t%s\t%d\t%s", name, owner, d, enc(obj.Type()))})
		case *types.Func:
			sig := obj.Type().(*types.Signature)
			var recv types.Type
			if sig.Recv() != nil {
				recv = sig.Recv().Type()
			}
			if recv == nil {
				out = append(out, member{name, fmt.Sprintf("?\t%s\t%d", name, d)})
				continue
			}
			if types.IsInterface(named) {
				d = 0
			}
			owner := ownerName(recv, pkg)
			if owner == "" {
				// An interface literal's method: no named owner.
				out = append(out, member{name, fmt.Sprintf("?\t%s\t%d", name, d)})
				continue
			}
			out = append(out, member{name, fmt.Sprintf("m\t%s\t%s\t%d%s", name, owner, d, results(sig))})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out
}

// fieldHolder: the type that declares the field at this index path.
func fieldHolder(t types.Type, index []int) types.Type {
	for _, i := range index[:len(index)-1] {
		if pt, ok := t.(*types.Pointer); ok {
			t = pt.Elem()
		}
		t = t.Underlying().(*types.Struct).Field(i).Type()
	}
	return t
}

// ownerName: "=" for the type itself (callers compare), a same-package
// type's name, or path.Name; "" when the owner is not a named type.
func ownerName(t types.Type, pkg *types.Package) string {
	if pt, ok := t.(*types.Pointer); ok {
		t = pt.Elem()
	}
	named, ok := types.Unalias(t).(*types.Named)
	if !ok {
		return ""
	}
	name := named.Origin().Obj().Name()
	if named.Obj().Pkg() == nil {
		return "builtin." + name
	}
	if named.Obj().Pkg() == pkg {
		return name
	}
	return named.Obj().Pkg().Path() + "." + name
}

func results(sig *types.Signature) string {
	var b strings.Builder
	for i := 0; i < sig.Results().Len(); i++ {
		b.WriteString("\t" + enc(sig.Results().At(i).Type()))
	}
	return b.String()
}

func enc(t types.Type) string {
	switch t := t.(type) {
	case *types.Alias:
		return enc(types.Unalias(t))
	case *types.Named:
		if t.Obj().Pkg() == nil {
			if t.Obj().Name() == "error" {
				return "builtin.error;"
			}
			return "?"
		}
		return t.Obj().Pkg().Path() + "." + t.Origin().Obj().Name() + ";"
	case *types.Pointer:
		return "*" + enc(t.Elem())
	case *types.Slice:
		return "[" + enc(t.Elem())
	case *types.Array:
		return "[" + enc(t.Elem())
	case *types.Map:
		return "M" + enc(t.Key()) + enc(t.Elem())
	case *types.Chan:
		return "C" + enc(t.Elem())
	}
	return "?"
}

// ---- merge ------------------------------------------------------------------

type entry struct {
	key, pkg, typ, value string
}

// merge: the entries every platform has identically. A member that differs
// or is missing somewhere is "?" at its shallowest depth; a package-level
// object or type that differs is left out (with its members).
func merge(dumps []map[string]string) []entry {
	keys := map[string]bool{}
	for _, d := range dumps {
		for k := range d {
			keys[k] = true
		}
	}
	sorted := make([]string, 0, len(keys))
	for k := range keys {
		sorted = append(sorted, k)
	}
	sort.Strings(sorted)
	dropped := map[string]bool{}
	var out []entry
	for _, k := range sorted {
		parts := strings.Split(k, "\x01")
		if len(parts) == 3 && dropped[parts[0]+"\x01"+parts[1]] {
			continue
		}
		if len(parts) >= 2 && dropped[parts[0]] {
			continue
		}
		values := map[string]bool{}
		missing := false
		minDepth := -1
		for _, d := range dumps {
			v, ok := d[k]
			if !ok {
				missing = true
				continue
			}
			values[v] = true
			if len(parts) == 3 {
				f := strings.Split(v, "\t")
				depth := f[2]
				if f[0] != "?" {
					depth = f[3]
				}
				n, _ := strconv.Atoi(depth)
				if minDepth < 0 || n < minDepth {
					minDepth = n
				}
			}
		}
		e := entry{key: k, pkg: parts[0]}
		if len(parts) == 3 {
			e.typ = parts[1]
		}
		if len(values) == 1 && !missing {
			for v := range values {
				e.value = v
			}
		} else if len(parts) == 3 {
			e.value = fmt.Sprintf("?\t%s\t%d", parts[2], minDepth)
		} else {
			dropped[k] = true
			continue
		}
		out = append(out, e)
	}
	return out
}

// ---- first release of each API name (GOROOT/api) ----------------------------

type sinceTable map[string]string // "pkg\x01Type\x01Member" -> "1.N"

var (
	apiLine   = regexp.MustCompile(`^pkg ([^ ,]+)(?: \([^)]*\))?, (.*)$`)
	apiMethod = regexp.MustCompile(`^method \(\*?(\w+)(?:\[[^\]]*\])?\) (\w+)`)
	apiField  = regexp.MustCompile(`^type (\w+)(?:\[[^\]]*\])? (?:struct|interface), (?:embedded \*?(?:\w+\.)?(\w+)|(\w+))`)
	apiType   = regexp.MustCompile(`^type (\w+)`)
	apiObject = regexp.MustCompile(`^(?:func|var|const) (\w+)`)
)

func apiSince(goroot string) sinceTable {
	files, err := filepath.Glob(filepath.Join(goroot, "api", "go1*.txt"))
	check(err)
	table := sinceTable{}
	for _, file := range files {
		version := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(file), "go"), ".txt")
		if version == "1" {
			version = "1.0"
		}
		b, err := os.ReadFile(file)
		check(err)
		for _, line := range strings.Split(string(b), "\n") {
			m := apiLine.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			pkg, rest := m[1], m[2]
			var key string
			if x := apiMethod.FindStringSubmatch(rest); x != nil {
				key = pkg + "\x01" + x[1] + "\x01" + x[2]
			} else if x := apiField.FindStringSubmatch(rest); x != nil {
				key = pkg + "\x01" + x[1] + "\x01" + x[2] + x[3]
			} else if x := apiType.FindStringSubmatch(rest); x != nil {
				key = pkg + "\x01" + x[1]
			} else if x := apiObject.FindStringSubmatch(rest); x != nil {
				key = pkg + "\x01" + x[1]
			} else {
				continue
			}
			if old, ok := table[key]; !ok || versionLess(version, old) {
				table[key] = version
			}
		}
	}
	return table
}

func versionLess(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 2; i++ {
		x, _ := strconv.Atoi(pa[i])
		y, _ := strconv.Atoi(pb[i])
		if x != y {
			return x < y
		}
	}
	return false
}

func sinceKey(fields []string) string { return fields[1] }

func (s sinceTable) of(pkg, name string) string {
	if v, ok := s[pkg+"\x01"+name]; ok {
		return v
	}
	return "1.0"
}

// member: the member's own line in the API files when it has one (methods
// of the type, promoted ones included, and declared fields); otherwise the
// later of the type's and the declaring owner's member release.
func (s sinceTable) member(pkg, typ string, fields []string) string {
	name, owner := fields[1], fields[2]
	if v, ok := s[pkg+"\x01"+typ+"\x01"+name]; ok {
		return v
	}
	best := s.of(pkg, typ)
	if owner != "=" {
		ownerPkg, ownerType := pkg, owner
		if dot := strings.LastIndex(owner, "."); dot >= 0 {
			ownerPkg, ownerType = owner[:dot], owner[dot+1:]
		}
		if v, ok := s[ownerPkg+"\x01"+ownerType+"\x01"+name]; ok && versionLess(best, v) {
			best = v
		}
	}
	return best
}

// insertSince: the since column after the name (T: after the kind; m and f:
// after the depth).
func insertSince(fields []string, since string) []string {
	at := 2
	switch fields[0] {
	case "T":
		at = 3
	case "m", "f":
		at = 4
	}
	out := append([]string{}, fields[:at]...)
	out = append(out, since)
	return append(out, fields[at:]...)
}

func check(err error) {
	if err != nil {
		fail(err.Error())
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "generate:", msg)
	os.Exit(1)
}
