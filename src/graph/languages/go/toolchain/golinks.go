// SPDX-License-Identifier: MIT

//go:build ignore

// golinks: the Go module's toolchain helper (W3-L). Standard library only. It
// asks the Go toolchain's own loader (`go list`) and type checker (`go/types`)
// for the code-graph facts of every main-module package, for ONE build
// configuration, and prints them as tab-separated records on stdout. It is
// built and run on demand by src/graph/languages/go/toolchain.ts, only for a
// project that opted in (`graph.toolchain.go` in .pymtheg/settings.json):
// running the toolchain on a project is as trusted as building it.
//
//	golinks -go <abs go> -goos <os> -goarch <arch> -gopath <dir> -gomodcache <dir> -gocache <fresh dir> [-overlay <file>] <module-dir>
//
// Everything below follows evidence/w2-l/golinks.go (the W2-L prototype), cut
// to what the product needs: source mode only, test files included, cgo off
// (a package needing cgo fails instead of being mislinked), offline, no
// sandbox and no experiment escapes. Every go command runs in an environment
// built from nothing (setupEnv); the caller starts this helper with an empty
// environment too. go.mod, go.sum, go.work and go.work.sum are pinned through
// -overlay, and every local directory is hashed before and after (exit 3 if
// anything under it changed).
//
// Soundness rules (docs/changes/W2-L.md):
//   - C and U records (calls, identifier uses) only for packages whose whole
//     import closure has no parse, type or list error;
//   - D and I records (implementer sets, implements pairs) only when NO loaded
//     package has an error.
//
// Records (paths relative to the module directory, else "$GOROOT/..." or
// "$GOMODCACHE/..."; offsets are BYTE offsets in the file):
//
//	V  goversion configuration
//	P  id main clean nfiles nerrors          a loaded package (clean = whole closure error-free)
//	F  file id clean                         a main-module file in this configuration
//	X  file id reason                        a main-module file go list left out (ignored, invalid)
//	E  id where message                      first errors (at most 20 in all)
//	C  file funEnd nameEnd cat class defFile defOff pkg name member   call expression
//	U  file identEnd kind class defFile defOff pkg name member        identifier use (not local, not universe)
//	   member (C-14): "=" not a selection; Owner.Name a field or concrete method
//	   with its declaring named type (C-17: a standard-library interface's
//	   method too, and error.Error); "?" no named owner, or another interface method
//	M  file pathEnd dir                      import of a package whose directory is in the project
//	FP sha256                                with -fingerprint only: every input of the facts (see fingerprint)
//	D  file funEnd ext defFile:defOff,...    interface call: main-module methods reached ("?": incomplete, a generic
//	                                         type may implement it); ext = implementers outside the main module
//	I  typeFile typeOff ifaceFile ifaceOff how                  implements pair (how = value|pointer)
//	S  key value                             summary
package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type module struct {
	Path      string
	Version   string
	Dir       string
	Main      bool
	GoVersion string
	GoMod     string
}

type listErr struct{ Pos, Err string }

type pkg struct {
	ImportPath     string
	Dir            string
	Name           string
	GoFiles        []string
	CgoFiles       []string
	IgnoredGoFiles []string
	InvalidGoFiles []string
	TestGoFiles    []string
	XTestGoFiles   []string
	ForTest        string
	ImportMap      map[string]string
	Imports        []string
	Standard       bool
	Module         *module
	Error          *listErr
	DepsErrors     []*listErr
}

var (
	fset     = token.NewFileSet()
	root     string
	goroot   string
	modroot  string
	out      *bufio.Writer
	overlay  map[string]string
	goBin    string
	childEnv []string
	nerrs    int
)

func rel(p string) string {
	if p == "" {
		return "-"
	}
	if r, err := filepath.Rel(root, p); err == nil && !strings.HasPrefix(r, "..") {
		return filepath.ToSlash(r)
	}
	if strings.HasPrefix(p, goroot+"/") {
		return "$GOROOT/" + p[len(goroot)+1:]
	}
	if strings.HasPrefix(p, modroot+"/") {
		return "$GOMODCACHE/" + p[len(modroot)+1:]
	}
	return p
}

func class(file string) string {
	switch {
	case file == "" || file == "-":
		return "none"
	case strings.HasPrefix(file, "$GOROOT/"):
		return "std"
	case strings.HasPrefix(file, "$GOMODCACHE/"):
		return "dep"
	case filepath.IsAbs(file):
		return "other"
	}
	return "module"
}

// pos: the file and byte offset of a position ("-", -1 when unknown).
func pos(p token.Pos) (string, int) {
	if !p.IsValid() {
		return "-", -1
	}
	pp := fset.Position(p)
	if pp.Filename == "" {
		return "-", -1
	}
	return rel(pp.Filename), pp.Offset
}

func emit(fields ...string) {
	for i, f := range fields {
		if i > 0 {
			out.WriteByte('\t')
		}
		out.WriteString(strings.NewReplacer("\t", " ", "\n", " ").Replace(f))
	}
	out.WriteByte('\n')
}

func errorf(id, where, msg string) {
	nerrs++
	if nerrs <= 20 {
		emit("E", id, where, msg)
	}
}

func main() {
	goF := flag.String("go", "", "REQUIRED: absolute path of the trusted go (<GOROOT>/bin/go)")
	goosF := flag.String("goos", "", "REQUIRED: GOOS")
	goarchF := flag.String("goarch", "", "REQUIRED: GOARCH")
	gopathF := flag.String("gopath", "", "REQUIRED: GOPATH")
	gomodcacheF := flag.String("gomodcache", "", "REQUIRED: module cache")
	gocacheF := flag.String("gocache", "", "REQUIRED: a fresh, empty build cache directory for this run (the caller removes it)")
	ovF := flag.String("overlay", "", "go list -overlay file; the helper reads those files from the overlay too")
	fpF := flag.Bool("fingerprint", false, "print only the FP record: a digest of every input of the facts (the caller's cache key)")
	flag.Parse()
	if flag.NArg() != 1 {
		fail(2, "usage: golinks [flags] <module-dir>")
	}
	for name, v := range map[string]string{"-go": *goF, "-gopath": *gopathF, "-gomodcache": *gomodcacheF, "-gocache": *gocacheF} {
		if v == "" || !filepath.IsAbs(v) {
			fail(2, name+" must be an absolute path")
		}
	}
	if *goosF == "" || *goarchF == "" {
		fail(2, "-goos and -goarch are required")
	}
	var err error
	root, err = filepath.Abs(flag.Arg(0))
	check(err)
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	setupEnv(*goF, *goosF, *goarchF, *gopathF, *gomodcacheF, *gocacheF)
	out = bufio.NewWriterSize(os.Stdout, 1<<20)
	defer out.Flush()

	// No workspace: the module at the root is loaded on its own (a go.work is
	// a known limit, reported by the caller). The -mod rule: vendor when the
	// module has vendor/modules.txt, else readonly: go never edits go.mod or go.sum.
	mod := "-mod=readonly"
	if _, err := os.Stat(filepath.Join(root, "vendor", "modules.txt")); err == nil {
		mod = "-mod=vendor"
	}
	setEnv("GOFLAGS", mod)
	// Standing assertion: nothing under the module root is written.
	before := treeHash(root)
	defer func() {
		if after := treeHash(root); after != before {
			emit("E", "project", ".", "files under the module root changed during indexing")
			out.Flush()
			os.Exit(3)
		}
	}()
	b, err := runGo(root, "version").Output()
	if err != nil || !strings.HasPrefix(string(b), "go version go") {
		fail(2, fmt.Sprintf("%s did not answer `go version`: %v", goBin, err))
	}
	goVersion := strings.Fields(string(b))[2]
	emit("V", goVersion, *goosF+"/"+*goarchF)

	// The overlay: the caller's (the snapshot's file contents), plus pins of
	// the files go may write (current content, or absence).
	ov := map[string]string{}
	if *ovF != "" {
		var o struct{ Replace map[string]string }
		b, err := os.ReadFile(*ovF)
		check(err)
		check(json.Unmarshal(b, &o))
		overlay = o.Replace
		for k, v := range o.Replace {
			ov[k] = v
		}
	}
	pinDir := filepath.Join(*gocacheF, "pin")
	check(os.MkdirAll(pinDir, 0o755))
	for i, f := range []string{"go.mod", "go.sum", "go.work", "go.work.sum"} {
		full := filepath.Join(root, f)
		if _, ok := ov[full]; ok {
			continue
		}
		b, err := os.ReadFile(full)
		if err != nil {
			ov[full] = ""
			continue
		}
		cp := filepath.Join(pinDir, fmt.Sprintf("pin%d", i))
		check(os.WriteFile(cp, b, 0o444))
		ov[full] = cp
	}
	ovb, _ := json.Marshal(map[string]any{"Replace": ov})
	ovFile := filepath.Join(pinDir, "overlay.json")
	check(os.WriteFile(ovFile, ovb, 0o444))

	if *fpF {
		emit("FP", fingerprint(ovFile))
		return
	}
	// Only the fields used: a plain `go list -json` would also stamp VCS
	// information (running git with the project's .git/config).
	fields := "ImportPath,Dir,Name,GoFiles,CgoFiles,IgnoredGoFiles,InvalidGoFiles,TestGoFiles,XTestGoFiles,ForTest,ImportMap,Imports,Standard,Module,Error,DepsErrors"
	cmd := runGo(root, "list", "-e", "-deps", "-test", "-buildvcs=false", "-json="+fields, "-overlay", ovFile, "./...")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	data, err := cmd.Output()
	if err != nil && len(data) == 0 {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		emit("E", "go-list", "-", msg)
		emit("S", "list-failed", "1")
		return
	}
	var pkgs []*pkg
	dec := json.NewDecoder(bytes.NewReader(data))
	for {
		var p pkg
		if err := dec.Decode(&p); err == io.EOF {
			break
		} else {
			check(err)
		}
		pkgs = append(pkgs, &p)
	}
	isMain := func(p *pkg) bool { return p.Module != nil && p.Module.Main }

	checked := map[string]*types.Package{}
	bad := map[string]bool{} // the package itself has an error
	infos := map[string]*types.Info{}
	files := map[string][]*ast.File{}
	var mainPkgs []*pkg
	// go list -deps prints dependencies first.
	for _, p := range pkgs {
		if p.ImportPath == "unsafe" {
			checked["unsafe"] = types.Unsafe
			continue
		}
		if strings.HasSuffix(p.ImportPath, ".test") && p.ForTest == "" && p.Name == "main" {
			continue // the generated test main
		}
		if p.Error != nil {
			bad[p.ImportPath] = true
			errorf(p.ImportPath, p.Error.Pos, p.Error.Err)
		}
		if len(p.DepsErrors) > 0 {
			bad[p.ImportPath] = true
		}
		names := append([]string{}, p.GoFiles...)
		if len(p.CgoFiles) > 0 {
			// cgo off: a cgo file is never type-checked (faked C gives wrong
			// links); go list does not list it with CGO_ENABLED=0 anyway.
			bad[p.ImportPath] = true
			errorf(p.ImportPath, rel(p.Dir), "needs cgo")
		}
		if len(names) == 0 && isMain(p) && p.Error == nil {
			bad[p.ImportPath] = true
			errorf(p.ImportPath, rel(p.Dir), "no Go files in this configuration")
		}
		var afiles []*ast.File
		for _, f := range names {
			full := f
			if !filepath.IsAbs(f) {
				full = filepath.Join(p.Dir, f)
			}
			var src any
			if r, ok := overlay[full]; ok {
				b, err := os.ReadFile(r)
				check(err)
				src = b
			}
			af, err := parser.ParseFile(fset, full, src, parser.AllErrors|parser.SkipObjectResolution)
			if err != nil {
				bad[p.ImportPath] = true
				errorf(p.ImportPath, rel(full), "parse: "+firstLine(err.Error()))
			}
			if af != nil {
				afiles = append(afiles, af)
			}
		}
		info := &types.Info{
			Types:      map[ast.Expr]types.TypeAndValue{},
			Defs:       map[*ast.Ident]types.Object{},
			Uses:       map[*ast.Ident]types.Object{},
			Selections: map[*ast.SelectorExpr]*types.Selection{},
			Instances:  map[*ast.Ident]types.Instance{},
		}
		this := p
		lang := ""
		if p.Module != nil && p.Module.GoVersion != "" {
			lang = "go" + p.Module.GoVersion
		}
		conf := types.Config{
			GoVersion: lang,
			Sizes:     types.SizesFor("gc", *goarchF),
			Importer: importerFunc(func(path string) (*types.Package, error) {
				id := path
				if m, ok := this.ImportMap[path]; ok {
					id = m
				}
				if c, ok := checked[id]; ok {
					return c, nil
				}
				return nil, fmt.Errorf("package %s not loaded", id)
			}),
			Error: func(err error) {
				if !bad[this.ImportPath] {
					te := err.(types.Error)
					f, o := pos(te.Pos)
					errorf(this.ImportPath, fmt.Sprintf("%s@%d", f, o), te.Msg)
				}
				bad[this.ImportPath] = true
			},
		}
		tp, _ := conf.Check(p.ImportPath, fset, afiles, info)
		checked[p.ImportPath] = tp
		if isMain(p) {
			infos[p.ImportPath] = info
			files[p.ImportPath] = afiles
			mainPkgs = append(mainPkgs, p)
			infoOf[tp] = info
		}
	}
	// clean: the package and its whole import closure have no error.
	clean := map[string]bool{}
	byID := map[string]*pkg{}
	for _, p := range pkgs {
		byID[p.ImportPath] = p
	}
	var isClean func(id string, seen map[string]bool) bool
	isClean = func(id string, seen map[string]bool) bool {
		if v, ok := clean[id]; ok {
			return v
		}
		if seen[id] {
			return true // a cycle is reported by go list as an error elsewhere
		}
		seen[id] = true
		p := byID[id]
		ok := p != nil && !bad[id] && (checked[id] != nil || id == "unsafe")
		if p != nil {
			for _, imp := range p.Imports {
				if imp == "C" || !isClean(imp, seen) {
					ok = false
				}
			}
		}
		clean[id] = ok
		return ok
	}
	universe := true
	for _, p := range pkgs {
		if strings.HasSuffix(p.ImportPath, ".test") && p.ForTest == "" && p.Name == "main" {
			continue
		}
		c := isClean(p.ImportPath, map[string]bool{})
		if bad[p.ImportPath] {
			universe = false
		}
		if isMain(p) {
			emit("P", p.ImportPath, "main", fmt.Sprint(c), fmt.Sprint(len(files[p.ImportPath])), fmt.Sprint(b2i(bad[p.ImportPath])))
		}
	}
	// Files: a non-test file is checked in its package and in the package's
	// test variant; it is clean if any variant it is in is clean.
	fileClean := map[string]bool{}
	fileIn := map[string]string{}
	for _, p := range mainPkgs {
		for _, af := range files[p.ImportPath] {
			r := rel(fset.Position(af.Pos()).Filename)
			fileIn[r] = basePath(p.ImportPath)
			if clean[p.ImportPath] {
				fileClean[r] = true
			} else if _, ok := fileClean[r]; !ok {
				fileClean[r] = false
			}
		}
		for _, f := range p.IgnoredGoFiles {
			emitOnce("X", rel(filepath.Join(p.Dir, f)), basePath(p.ImportPath), "ignored")
		}
		for _, f := range p.InvalidGoFiles {
			emitOnce("X", rel(filepath.Join(p.Dir, f)), basePath(p.ImportPath), "invalid")
		}
		for _, f := range p.CgoFiles {
			emitOnce("X", rel(filepath.Join(p.Dir, f)), basePath(p.ImportPath), "cgo")
		}
	}
	var fl []string
	for f := range fileClean {
		fl = append(fl, f)
	}
	sort.Strings(fl)
	for _, f := range fl {
		emit("F", f, fileIn[f], fmt.Sprint(fileClean[f]))
	}

	// Records for clean main-module packages, de-duplicated by text (a
	// non-test file is in a package and its test variant).
	seen := map[string]bool{}
	rec := func(fields ...string) {
		k := strings.Join(fields, "\t")
		if !seen[k] {
			seen[k] = true
			emit(fields...)
		}
	}
	var dyn []ifaceCall
	for _, p := range mainPkgs {
		if !clean[p.ImportPath] {
			continue
		}
		info := infos[p.ImportPath]
		plain := p.ForTest == "" && !strings.HasSuffix(p.ImportPath, "_test")
		for _, af := range files[p.ImportPath] {
			selOf := map[*ast.Ident]*ast.SelectorExpr{}
			ast.Inspect(af, func(n ast.Node) bool {
				switch n := n.(type) {
				case *ast.CallExpr:
					cat, obj, recv := classify(info, n)
					file, _ := pos(n.Lparen)
					funEnd := fset.Position(unparen(n.Fun).End()).Offset
					nameEnd := funEnd
					if id := identOf(stripIndex(unparen(n.Fun))); id != nil {
						nameEnd = fset.Position(id.End()).Offset
					}
					df, do, dpkg, dname := "-", -1, "-", "-"
					if obj != nil {
						df, do = pos(obj.Pos())
						dname = obj.Name()
						if obj.Pkg() != nil {
							dpkg = basePath(obj.Pkg().Path())
						}
					}
					dclass := class(df)
					if cat == "builtin" || (obj != nil && obj.Pkg() == nil) {
						dclass = "builtin"
					}
					rec("C", file, fmt.Sprint(funEnd), fmt.Sprint(nameEnd), cat, dclass, df, fmt.Sprint(do), dpkg, dname, memberOf(info, stripIndex(unparen(n.Fun)), obj))
					if (cat == "iface" || cat == "typeparam") && recv != nil && plain {
						dyn = append(dyn, ifaceCall{file, funEnd, recv, obj.(*types.Func)})
					}
				case *ast.ImportSpec:
					// M file pathEnd dir: the imported package's directory, when
					// it is a file of the project (a main-module or vendored
					// package); the module cache and GOROOT are not graph files.
					path := strings.Trim(n.Path.Value, "\"`")
					id := path
					if m, ok := p.ImportMap[path]; ok {
						id = m
					}
					if q := byID[id]; q != nil && path != "C" {
						file, _ := pos(n.Path.Pos())
						dir := rel(q.Dir)
						if class(dir) == "module" {
							rec("M", file, fmt.Sprint(fset.Position(n.Path.End()).Offset), dir)
						}
					}
				case *ast.SelectorExpr:
					selOf[n.Sel] = n
				case *ast.Ident:
					obj := info.Uses[n]
					if obj == nil || obj.Parent() == types.Universe {
						return true
					}
					if _, ok := obj.(*types.PkgName); ok {
						return true
					}
					if obj.Parent() != nil && (obj.Pkg() == nil || obj.Parent() != obj.Pkg().Scope()) {
						return true // a local: no graph symbol
					}
					file, _ := pos(n.Pos())
					end := fset.Position(n.End()).Offset
					df, do := pos(obj.Pos())
					pk := "-"
					if obj.Pkg() != nil {
						pk = basePath(obj.Pkg().Path())
					}
					member := "="
					if se := selOf[n]; se != nil {
						member = memberOf(info, se, obj)
					}
					rec("U", file, fmt.Sprint(end), objKind(obj), class(df), df, fmt.Sprint(do), pk, obj.Name(), member)
				}
				return true
			})
		}
	}
	emit("S", "universe-clean", fmt.Sprint(universe))
	emit("S", "errors", fmt.Sprint(nerrs))
	if universe {
		implementsPairs(mainPkgs, checked)
		dispatch(pkgs, checked, dyn)
	}
}

// fingerprint: a digest of everything the facts depend on that can change
// without a version change: go list's own report (packages, files, imports,
// module versions, errors), and the content of every listed file and go.mod
// of every package outside GOROOT and the module cache (the main module,
// local replace targets inside or outside the project, vendored packages),
// read from the overlay where the caller gave one. Module-cache and GOROOT
// files are immutable for their version, which the report includes.
func fingerprint(ovFile string) string {
	fields := "ImportPath,Dir,Name,GoFiles,CgoFiles,IgnoredGoFiles,InvalidGoFiles,TestGoFiles,XTestGoFiles,ForTest,ImportMap,Imports,Standard,Module,Error,DepsErrors"
	cmd := runGo(root, "list", "-e", "-deps", "-test", "-buildvcs=false", "-json="+fields, "-overlay", ovFile, "./...")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	data, _ := cmd.Output()
	h := sha256.New()
	h.Write([]byte("stderr\x00"))
	h.Write(stderr.Bytes())
	mutable := func(dir string) bool {
		return dir != "" && !strings.HasPrefix(dir, goroot+"/") && dir != goroot && !strings.HasPrefix(dir, modroot+"/")
	}
	content := func(path string) {
		fmt.Fprintf(h, "\x00%s\x00", path)
		if r, ok := overlay[path]; ok {
			path = r
		}
		if b, err := os.ReadFile(path); err == nil {
			h.Write(b)
		} else {
			fmt.Fprintf(h, "unreadable %v", err)
		}
	}
	mods := map[string]bool{}
	dec := json.NewDecoder(bytes.NewReader(data))
	for {
		var p pkg
		if err := dec.Decode(&p); err != nil {
			break
		}
		// The generated test main lives in the per-run build cache (its paths
		// change every run) and is not type-checked: left out.
		if strings.HasSuffix(p.ImportPath, ".test") && p.ForTest == "" && p.Name == "main" {
			continue
		}
		// go list's report of the package, re-encoded (stable field order).
		b, _ := json.Marshal(p)
		h.Write(b)
		if p.Standard || !mutable(p.Dir) {
			continue
		}
		for _, list := range [][]string{p.GoFiles, p.CgoFiles, p.TestGoFiles, p.XTestGoFiles} {
			for _, f := range list {
				content(filepath.Join(p.Dir, f))
			}
		}
		if p.Module != nil && p.Module.GoMod != "" && mutable(filepath.Dir(p.Module.GoMod)) && !mods[p.Module.GoMod] {
			mods[p.Module.GoMod] = true
			content(p.Module.GoMod)
		}
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func firstLine(s string) string {
	return strings.SplitN(s, "\n", 2)[0]
}

type ifaceCall struct {
	file string
	off  int
	t    types.Type
	fn   *types.Func
}

var infoOf = map[*types.Package]*types.Info{}

// namedTypes: the defined types declared in p (package scope; for main-module
// packages also function-local declarations).
func namedTypes(p *types.Package) []*types.TypeName {
	var res []*types.TypeName
	if info := infoOf[p]; info != nil {
		for _, o := range info.Defs {
			if tn, ok := o.(*types.TypeName); ok && tn.Pkg() == p && !tn.IsAlias() {
				if _, ok := tn.Type().(*types.Named); ok {
					res = append(res, tn)
				}
			}
		}
		sort.Slice(res, func(i, j int) bool { return res[i].Pos() < res[j].Pos() })
		return res
	}
	sc := p.Scope()
	for _, n := range sc.Names() {
		if tn, ok := sc.Lookup(n).(*types.TypeName); ok && !tn.IsAlias() {
			if _, ok := tn.Type().(*types.Named); ok {
				res = append(res, tn)
			}
		}
	}
	return res
}

// dispatch: for each interface or type-parameter method call in a plain
// main-module package, the main-module methods that the call can reach: the
// method selected by M on every named, non-generic, non-interface type of a
// loaded plain package such that T or *T implements the call's receiver
// interface (types.Satisfies for a type parameter's constraint). ext counts
// implementers outside the main module (dependencies, standard library). The
// universe is the packages loaded for this configuration.
func dispatch(pkgs []*pkg, checked map[string]*types.Package, dyn []ifaceCall) {
	type cand struct {
		t    types.Type
		main bool
	}
	var cands []cand
	// Method names of main-module generic types: an instantiation of one may
	// implement the interface, and the search below does not instantiate, so a
	// set that could reach such a method is marked incomplete (and the same
	// for test-file types, below).
	genericMethods := map[string]bool{}
	// Method names declared on types in main-module _test.go files: a call in
	// a plain package also runs in its test binary, where such a type may be
	// the dynamic value; the search below covers plain packages only.
	for _, p := range pkgs {
		if p.Module == nil || !p.Module.Main || (p.ForTest == "" && !strings.HasSuffix(p.ImportPath, "_test")) {
			continue
		}
		tp := checked[p.ImportPath]
		if tp == nil {
			continue
		}
		for _, tn := range namedTypes(tp) {
			if !strings.HasSuffix(fset.Position(tn.Pos()).Filename, "_test.go") {
				continue
			}
			if nt, ok := tn.Type().(*types.Named); ok {
				for i := 0; i < nt.NumMethods(); i++ {
					genericMethods[nt.Method(i).Name()] = true
				}
			}
		}
	}
	for _, p := range pkgs {
		if p.ForTest != "" || strings.HasSuffix(p.ImportPath, ".test") || strings.Contains(p.ImportPath, " ") {
			continue
		}
		tp := checked[p.ImportPath]
		if tp == nil {
			continue
		}
		main := p.Module != nil && p.Module.Main
		for _, tn := range namedTypes(tp) {
			nt := tn.Type().(*types.Named)
			if nt.TypeParams().Len() > 0 {
				if main {
					for i := 0; i < nt.NumMethods(); i++ {
						genericMethods[nt.Method(i).Name()] = true
					}
				}
				continue
			}
			if types.IsInterface(nt) || nt.Underlying() == types.Typ[types.Invalid] {
				continue
			}
			cands = append(cands, cand{nt, main})
		}
	}
	// Unnamed struct types with embedded fields, as written in main-module code
	// (`struct{ reader; closer }{}`): they have the promoted methods, so a
	// value of one may implement the interface. Each distinct one (by
	// types.Identical) is a candidate.
	var anon []types.Type
	for _, p := range pkgs {
		if p.Module == nil || !p.Module.Main || p.ForTest != "" || strings.HasSuffix(p.ImportPath, "_test") {
			continue
		}
		info := infoOf[checked[p.ImportPath]]
		if info == nil {
			continue
		}
		var exprs []ast.Expr
		for e := range info.Types {
			exprs = append(exprs, e)
		}
		sort.Slice(exprs, func(i, j int) bool { return exprs[i].Pos() < exprs[j].Pos() })
		for _, e := range exprs {
			t := info.Types[e].Type
			if pt, ok := t.(*types.Pointer); ok {
				t = pt.Elem()
			}
			st, ok := t.(*types.Struct)
			if !ok {
				continue
			}
			embeds := false
			for i := 0; i < st.NumFields(); i++ {
				if st.Field(i).Embedded() {
					embeds = true
				}
			}
			if !embeds {
				continue
			}
			known := false
			for _, a := range anon {
				if types.Identical(a, st) {
					known = true
					break
				}
			}
			if !known {
				anon = append(anon, st)
				cands = append(cands, cand{st, true})
			}
		}
	}
	// The same in _test.go files: an unnamed struct with embedded fields
	// written there (`Use(struct{ r; c }{})`) is a dynamic value only in the
	// test binary, which the search above does not cover. Like a test-file
	// named type, its promoted method names withhold verification.
	for _, p := range pkgs {
		if p.Module == nil || !p.Module.Main || (p.ForTest == "" && !strings.HasSuffix(p.ImportPath, "_test")) {
			continue
		}
		info := infoOf[checked[p.ImportPath]]
		if info == nil {
			continue
		}
		for e, tv := range info.Types {
			if !strings.HasSuffix(fset.Position(e.Pos()).Filename, "_test.go") {
				continue
			}
			t := tv.Type
			if pt, ok := t.(*types.Pointer); ok {
				t = pt.Elem()
			}
			st, ok := t.(*types.Struct)
			if !ok {
				continue
			}
			embeds := false
			for i := 0; i < st.NumFields(); i++ {
				if st.Field(i).Embedded() {
					embeds = true
				}
			}
			if !embeds {
				continue
			}
			ms := types.NewMethodSet(types.NewPointer(st))
			for i := 0; i < ms.Len(); i++ {
				genericMethods[ms.At(i).Obj().Name()] = true
			}
		}
	}
	memo := map[string]string{}
	for _, d := range dyn {
		tp, isTP := d.t.(*types.TypeParam)
		var it *types.Interface
		if isTP {
			it, _ = tp.Constraint().Underlying().(*types.Interface)
		} else {
			it, _ = d.t.Underlying().(*types.Interface)
		}
		if it == nil {
			continue
		}
		sat := types.Implements
		if isTP {
			sat = types.Satisfies
		}
		// The memo key must identify the receiver TYPE, not its declaration:
		// Getter[int] and Getter[string] share Obj() but have different method
		// sets. Only an uninstantiated named type (its Obj() is the type) or a
		// type parameter (unique object) is memoised; an instantiation is
		// computed afresh.
		key := ""
		switch t := d.t.(type) {
		case *types.Named:
			if t.TypeArgs().Len() == 0 {
				key = fmt.Sprintf("%p.%s", t.Obj(), d.fn.Name())
			}
		case *types.TypeParam:
			key = fmt.Sprintf("tp%p.%s", t.Obj(), d.fn.Name())
		}
		line, ok := memo[key]
		if !ok || key == "" {
			ext := 0
			var meth []string
			for _, k := range cands {
				if !(sat(k.t, it) || sat(types.NewPointer(k.t), it)) {
					continue
				}
				if !k.main {
					ext++
					continue
				}
				o, _, _ := types.LookupFieldOrMethod(types.NewPointer(k.t), true, d.fn.Pkg(), d.fn.Name())
				if o != nil {
					f, off := pos(o.Pos())
					meth = append(meth, fmt.Sprintf("%s:%d", f, off))
				}
			}
			sort.Strings(meth)
			meth = dedup(meth)
			if genericMethods[d.fn.Name()] {
				// incomplete: a generic type's method of this name may be reached
				meth = []string{"?"}
			}
			line = fmt.Sprint(ext) + "\t" + strings.Join(meth, ",")
			if key != "" {
				memo[key] = line
			}
		}
		parts := strings.SplitN(line, "\t", 2)
		emit("D", d.file, fmt.Sprint(d.off), parts[0], parts[1])
	}
}

func dedup(xs []string) []string {
	var res []string
	for i, x := range xs {
		if i == 0 || x != xs[i-1] {
			res = append(res, x)
		}
	}
	return res
}

// implementsPairs: every (type, interface) pair of the main module's plain
// packages where the type or its pointer implements the interface (method
// sets, not constraints; interfaces with at least one method; no generic
// types), and the same within each test variant's closure.
func implementsPairs(mainPkgs []*pkg, checked map[string]*types.Package) {
	collect := func(p *types.Package) (ts, is []*types.TypeName) {
		if p == nil {
			return
		}
		for _, tn := range namedTypes(p) {
			nt := tn.Type().(*types.Named)
			if nt.TypeParams().Len() > 0 {
				continue
			}
			if it, ok := nt.Underlying().(*types.Interface); ok {
				if it.IsMethodSet() && it.NumMethods() > 0 {
					is = append(is, tn)
				}
			} else {
				ts = append(ts, tn)
			}
		}
		return
	}
	seen := map[string]bool{}
	pairs := func(ts, is []*types.TypeName) {
		for _, t := range ts {
			for _, i := range is {
				it := i.Type().Underlying().(*types.Interface)
				how := ""
				if types.Implements(t.Type(), it) {
					how = "value"
				} else if types.Implements(types.NewPointer(t.Type()), it) {
					how = "pointer"
				}
				if how == "" {
					continue
				}
				tf, to := pos(t.Pos())
				iff, io := pos(i.Pos())
				k := fmt.Sprint(tf, to, iff, io)
				if seen[k] {
					continue
				}
				seen[k] = true
				emit("I", tf, fmt.Sprint(to), iff, fmt.Sprint(io), how)
			}
		}
	}
	main := map[string]bool{}
	for _, q := range mainPkgs {
		main[q.ImportPath] = true
	}
	var pts, pis []*types.TypeName
	for _, p := range mainPkgs {
		if p.ForTest == "" && !strings.HasSuffix(p.ImportPath, "_test") {
			t, i := collect(checked[p.ImportPath])
			pts, pis = append(pts, t...), append(pis, i...)
		}
	}
	pairs(pts, pis)
	for _, p := range mainPkgs {
		if p.ForTest == "" && !strings.HasSuffix(p.ImportPath, "_test") {
			continue
		}
		var ts, is []*types.TypeName
		for _, cp := range closure(checked[p.ImportPath]) {
			if !main[pathID(cp, checked)] {
				continue
			}
			t, i := collect(cp)
			ts, is = append(ts, t...), append(is, i...)
		}
		pairs(ts, is)
	}
}

func pathID(p *types.Package, checked map[string]*types.Package) string {
	var ids []string
	for id, c := range checked {
		if c == p {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		return ""
	}
	return ids[0]
}

func closure(p *types.Package) []*types.Package {
	var res []*types.Package
	seen := map[*types.Package]bool{}
	var walk func(*types.Package)
	walk = func(q *types.Package) {
		if q == nil || seen[q] {
			return
		}
		seen[q] = true
		res = append(res, q)
		for _, i := range q.Imports() {
			walk(i)
		}
	}
	walk(p)
	return res
}

func basePath(p string) string {
	if i := strings.IndexByte(p, ' '); i >= 0 {
		return p[:i]
	}
	return p
}

var emitted = map[string]bool{}

func emitOnce(fields ...string) {
	k := strings.Join(fields, "\t")
	if !emitted[k] {
		emitted[k] = true
		emit(fields...)
	}
}

type importerFunc func(string) (*types.Package, error)

func (f importerFunc) Import(p string) (*types.Package, error) { return f(p) }

func objKind(o types.Object) string {
	switch o := o.(type) {
	case *types.Func:
		if o.Type().(*types.Signature).Recv() != nil {
			return "method"
		}
		return "func"
	case *types.Var:
		if o.IsField() {
			return "field"
		}
		return "var"
	case *types.Const:
		return "const"
	case *types.TypeName:
		return "type"
	}
	return "other"
}

func unparen(e ast.Expr) ast.Expr {
	for {
		p, ok := e.(*ast.ParenExpr)
		if !ok {
			return e
		}
		e = p.X
	}
}

// classify: the call category, the callee object (nil when none) and, for
// interface and type-parameter calls, the static receiver type that supplies
// the method (after promotion through embedded fields).
func classify(info *types.Info, call *ast.CallExpr) (string, types.Object, types.Type) {
	fun := unparen(call.Fun)
	if tv, ok := info.Types[fun]; ok {
		if tv.IsType() {
			return "conversion", typeObj(info, fun), nil
		}
		if tv.IsBuiltin() {
			return "builtin", identObj(info, fun), nil
		}
	} else {
		return "untyped", nil, nil
	}
	switch x := fun.(type) {
	case *ast.IndexExpr:
		if _, ok := info.Instances[identOf(x.X)]; ok || isFuncObj(info, x.X) {
			fun = unparen(x.X)
		}
	case *ast.IndexListExpr:
		fun = unparen(x.X)
	}
	switch f := fun.(type) {
	case *ast.Ident:
		switch o := info.Uses[f].(type) {
		case *types.Func:
			return "func", o, nil
		case *types.Var:
			return "funcvalue", o, nil
		case nil:
			return "untyped", nil, nil
		default:
			return "other", o, nil
		}
	case *ast.SelectorExpr:
		if sel, ok := info.Selections[f]; ok {
			switch sel.Kind() {
			case types.FieldVal:
				return "funcvalue", sel.Obj(), nil
			case types.MethodVal, types.MethodExpr:
				fn := sel.Obj().(*types.Func)
				h := holder(sel)
				if _, ok := h.(*types.TypeParam); ok {
					return "typeparam", fn, h
				}
				if types.IsInterface(h) {
					return "iface", fn, h
				}
				return "method", fn, nil
			}
		}
		switch o := info.Uses[f.Sel].(type) {
		case *types.Func:
			return "func", o, nil
		case *types.Var:
			return "funcvalue", o, nil
		case nil:
			return "untyped", nil, nil
		default:
			return "other", o, nil
		}
	case *ast.FuncLit:
		return "funclit", nil, nil
	}
	return "dynamic", nil, nil
}

// memberOf: a C or U record's member field (C-14). "=" when e is no
// selection (a package-level object, named directly, through a qualifier or
// a dot import); for a field or method selection, Owner.Name with the
// declaring named type go/types selected (after promotion through embedded
// fields); "?" when that owner is not a named type of the object's own
// package, or is an interface outside the standard library (a call through
// it is dispatch). C-17: error.Error for the predeclared error interface.
func memberOf(info *types.Info, e ast.Expr, obj types.Object) string {
	sel, ok := e.(*ast.SelectorExpr)
	if !ok {
		return "="
	}
	s, ok := info.Selections[sel]
	if !ok {
		return "="
	}
	var owner types.Type
	switch s.Kind() {
	case types.FieldVal:
		owner = holder(s)
	case types.MethodVal, types.MethodExpr:
		fn, ok := s.Obj().(*types.Func)
		if !ok {
			return "?"
		}
		recv := fn.Type().(*types.Signature).Recv()
		if recv == nil {
			return "?"
		}
		owner = recv.Type()
		if pt, ok := owner.(*types.Pointer); ok {
			owner = pt.Elem()
		}
	}
	if owner == nil || obj == nil {
		return "?"
	}
	named, ok := types.Unalias(owner).(*types.Named)
	if !ok {
		return "?"
	}
	// C-17: a method of the predeclared error interface, and a method of a
	// standard-library interface, name the interface that declares them.
	if named.Obj().Pkg() == nil {
		if named.Obj().Name() == "error" && obj.Pkg() == nil {
			return "error." + obj.Name()
		}
		return "?"
	}
	if named.Obj().Pkg() != obj.Pkg() {
		return "?"
	}
	if types.IsInterface(named) {
		if f, _ := pos(named.Obj().Pos()); class(f) != "std" {
			return "?"
		}
	}
	return named.Origin().Obj().Name() + "." + obj.Name()
}

func holder(sel *types.Selection) types.Type {
	t := sel.Recv()
	idx := sel.Index()
	for _, i := range idx[:len(idx)-1] {
		if pt, ok := t.(*types.Pointer); ok {
			t = pt.Elem()
		}
		st, ok := t.Underlying().(*types.Struct)
		if !ok {
			break
		}
		t = st.Field(i).Type()
	}
	if pt, ok := t.(*types.Pointer); ok {
		t = pt.Elem()
	}
	return t
}

func stripIndex(e ast.Expr) ast.Expr {
	switch x := e.(type) {
	case *ast.IndexExpr:
		return unparen(x.X)
	case *ast.IndexListExpr:
		return unparen(x.X)
	}
	return e
}

func identOf(e ast.Expr) *ast.Ident {
	switch x := unparen(e).(type) {
	case *ast.Ident:
		return x
	case *ast.SelectorExpr:
		return x.Sel
	}
	return nil
}

func isFuncObj(info *types.Info, e ast.Expr) bool {
	id := identOf(e)
	if id == nil {
		return false
	}
	_, ok := info.Uses[id].(*types.Func)
	return ok
}

func identObj(info *types.Info, e ast.Expr) types.Object {
	if id := identOf(e); id != nil {
		return info.Uses[id]
	}
	return nil
}

func typeObj(info *types.Info, e ast.Expr) types.Object {
	// A conversion to a pointer type, (*T)(x): the type named is T.
	if star, ok := unparen(e).(*ast.StarExpr); ok {
		e = unparen(star.X)
	}
	switch x := e.(type) {
	case *ast.IndexExpr:
		e = x.X
	case *ast.IndexListExpr:
		e = x.X
	}
	if id := identOf(e); id != nil {
		if o, ok := info.Uses[id].(*types.TypeName); ok {
			return o
		}
	}
	return nil
}

// ---- The closed environment (evidence/w2-l/golinks.go, setupEnv): nothing
// of the caller's environment reaches go; every value is set here.

func setupEnv(gobin, goos, goarch, gopath, modcache, gocache string) {
	p := gobin
	if q, err := filepath.EvalSymlinks(p); err == nil {
		p = q
	}
	bindir := filepath.Dir(p)
	gorootDir := filepath.Dir(bindir)
	if filepath.Base(bindir) != "bin" || filepath.Base(p) != "go" {
		fail(2, fmt.Sprintf("the go binary %s is not <GOROOT>/bin/go", p))
	}
	if st, err := os.Stat(filepath.Join(gorootDir, "src", "runtime")); err != nil || !st.IsDir() {
		fail(2, fmt.Sprintf("%s has no src/runtime: not a Go installation", gorootDir))
	}
	goBin = p
	check(os.MkdirAll(filepath.Join(gocache, "tmp"), 0o755))
	childEnv = []string{
		"PATH=" + bindir, "GOENV=off", "GOROOT=" + gorootDir,
		"GOPATH=" + gopath, "GOMODCACHE=" + modcache, "GOCACHE=" + gocache,
		"GOTMPDIR=" + filepath.Join(gocache, "tmp"),
		"GOOS=" + goos, "GOARCH=" + goarch, "CGO_ENABLED=0", "GOWORK=off",
		"GOFLAGS=", "GO111MODULE=on", "GOTOOLCHAIN=local",
		"GOPROXY=off", "GOSUMDB=off", "GONOSUMDB=", "GONOSUMCHECK=", "GOPRIVATE=",
		"GONOPROXY=", "GOINSECURE=", "GOVCS=*:off", "GOAUTH=off",
		"GOTELEMETRY=off", "GOEXPERIMENT=", "GODEBUG=", "GOCACHEPROG=",
		"GOAMD64=v1", "GO386=sse2", "GOARM=7", "GOARM64=v8.0", "GOMIPS=hardfloat",
		"GOMIPS64=hardfloat", "GOPPC64=power8", "GORISCV64=rva20u64", "GOWASM=",
	}
	goroot, _ = filepath.EvalSymlinks(gorootDir)
	modroot = modcache
	if q, err := filepath.EvalSymlinks(modroot); err == nil {
		modroot = q
	}
}

func setEnv(k, v string) {
	for i, e := range childEnv {
		if strings.HasPrefix(e, k+"=") {
			childEnv[i] = k + "=" + v
			return
		}
	}
	childEnv = append(childEnv, k+"="+v)
}

func runGo(dir string, args ...string) *exec.Cmd {
	c := exec.Command(goBin, args...)
	c.Env, c.Dir = childEnv, dir
	return c
}

// treeHash: a digest of every regular file under dir (path, mode, size,
// content) and of every directory and symlink name. Directories whose name
// starts with "." or "_" are skipped (go ignores them; .pymtheg is the
// indexer's own storage).
func treeHash(dir string) string {
	h := sha256.New()
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			fmt.Fprintf(h, "ERR %s\n", p)
			return nil
		}
		if d.IsDir() && p != dir && (strings.HasPrefix(d.Name(), ".") || strings.HasPrefix(d.Name(), "_")) {
			return filepath.SkipDir
		}
		r, _ := filepath.Rel(dir, p)
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		fmt.Fprintf(h, "%s %o %d\n", r, info.Mode(), info.Size())
		if info.Mode().IsRegular() {
			if f, err := os.Open(p); err == nil {
				io.Copy(h, f)
				f.Close()
			}
		}
		return nil
	})
	return fmt.Sprintf("%x", h.Sum(nil))
}

func check(err error) {
	if err != nil {
		fail(2, err.Error())
	}
}

func fail(code int, msg string) {
	if out != nil {
		out.Flush()
	}
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(code)
}
