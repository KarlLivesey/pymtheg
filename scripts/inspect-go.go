// Parser-only validation: empty result bodies are deliberately unfinished.
package main
import("encoding/json";"go/ast";"go/parser";"go/token";"os")
func main(){f,err:=parser.ParseFile(token.NewFileSet(),os.Args[len(os.Args)-1],nil,parser.AllErrors);if err!=nil{panic(err)};functions:=0;for _,d:=range f.Decls{if fn,ok:=d.(*ast.FuncDecl);ok{functions++;if fn.Body==nil||len(fn.Body.List)!=0{panic("function body is not empty")}}};json.NewEncoder(os.Stdout).Encode(map[string]int{"emptyFunctions":functions})}
