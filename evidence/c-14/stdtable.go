// SPDX-License-Identifier: MIT

//go:build ignore

// C-14 estimate only (not shipped): the size of a "standard library member
// table": for every exported named type of every importable standard
// package, each exported field and method in its method set (value and
// pointer receiver, promoted members included) with its declaring owner.
package main

import (
	"fmt"
	"go/importer"
	"go/token"
	"go/types"
	"os"
	"os/exec"
	"strings"
)

func main() {
	out, err := exec.Command("go", "list", "std").Output()
	if err != nil {
		panic(err)
	}
	fset := token.NewFileSet()
	imp := importer.ForCompiler(fset, "source", nil)
	var pkgs, typesN, declared, promoted, fields, bytes int
	for _, path := range strings.Fields(string(out)) {
		if strings.Contains(path, "internal") || strings.HasPrefix(path, "vendor/") || strings.HasPrefix(path, "cmd/") {
			continue
		}
		p, err := imp.Import(path)
		if err != nil {
			fmt.Fprintln(os.Stderr, path, err)
			continue
		}
		pkgs++
		scope := p.Scope()
		for _, name := range scope.Names() {
			tn, ok := scope.Lookup(name).(*types.TypeName)
			if !ok || !tn.Exported() {
				continue
			}
			named, ok := tn.Type().(*types.Named)
			if !ok {
				continue
			}
			typesN++
			ms := types.NewMethodSet(types.NewPointer(named))
			if types.IsInterface(named) {
				ms = types.NewMethodSet(named)
			}
			for i := 0; i < ms.Len(); i++ {
				sel := ms.At(i)
				if !sel.Obj().Exported() {
					continue
				}
				owner := "builtin"
				if sel.Obj().Pkg() != nil {
					owner = sel.Obj().Pkg().Path()
				}
				line := fmt.Sprintf("%s\t%s\t%s\t%s\n", path, name, sel.Obj().Name(), owner)
				bytes += len(line)
				if len(sel.Index()) > 1 {
					promoted++
				} else {
					declared++
				}
			}
			if st, ok := named.Underlying().(*types.Struct); ok {
				for i := 0; i < st.NumFields(); i++ {
					if st.Field(i).Exported() {
						fields++
						bytes += len(path) + len(name) + len(st.Field(i).Name()) + 4
					}
				}
			}
		}
	}
	v, _ := exec.Command("go", "version").Output()
	fmt.Printf("%s", v)
	fmt.Printf("packages %d, exported named types %d, methods declared %d, methods promoted %d, exported fields (declared, depth 0) %d, table bytes (tab-separated, uncompressed) %d\n", pkgs, typesN, declared, promoted, fields, bytes)
}
