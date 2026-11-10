# Pymtheg grammar (current implementation)

Identifiers are ASCII, comments `//` through newline, strings JSON quoted,
integers arbitrary precision. Whitespace insignificant. Semicolons required.
Expression precedence: ||, &&, == !=, < <= > >=, + -, *, unary ! -, postfix.

```ebnf
project = { import | type | resource | op | rule | flow | machine } ;
import = 'import' string ';' ;
type = 'type' name '=' ( '{' fields '}' | variant { '|' variant } ) ';' ;
variant = name [ '(' typeRef ')' ] ;
typeRef = name [ '<' typeRef { ',' typeRef } '>' ] ;
resource = 'resource' name '{' 'states' names ';' 'initial' name ';'
           'terminal' names ';' { name '->' name ';' } '}' ;
params = '(' [ [ 'take' | 'borrow' ] name ':' typeRef { ',' ... } ] ')' ;
op = 'op' name params '->' typeRef metadata ';' ;
rule = 'rule' name params '->' typeRef metadata '=' expr ';' ;
flow = 'flow' name params '->' typeRef metadata block [ 'on' 'cancel' block ] ;
metadata = { 'effects' '(' [ names ] ')' | 'cost' metric ('exact'|'upper') expr
           | 'overhead' metric ('exact'|'upper') expr | 'budget' metric '<=' expr
           | 'bound' name '<=' integer | 'requires' expr
           | 'ensures' expr | 'settles' name 'on' '(' names ')' | 'stable'
           | 'creates' 'result' | 'atomic' | protocol } ;
protocol = 'protocol' name '{' 'submit' name ';'
           { 'outcome' expr 'when' expr ';' } '}' ;
block = '{' { statement } '}' ;
statement = 'let' name '=' expr ';' | 'call' name '(' args ')' ['as' name] ';'
          | 'if' expr block [ 'else' block ]
          | 'match' expr '{' { name ['(' name ')'] '=>' block } '}'
          | 'for' name 'in' expr block | 'retry' expr 'on' name block
          | 'return' expr ';' | 'propagate' expr ';' | 'assert' expr ';'
          | 'own' name ':' name ';' | 'move' name ';'
          | 'transition' name '->' name ';' | 'unknown' string ';' ;
args = [ ['take'|'borrow'] expr { ',' ... } ] ;
expr = integer | string | 'true' | 'false' | 'unit' | name | expr '.' name
     | name '(' args ')' | name '{' fieldsValues '}' | '[' [args] ']'
     | '(' expr ')' | unary expr | expr binary expr | 'unknown' string ;
machine = 'machine' name '{' { state | event | invariant } '}' ;
state = 'state' name ':' ('Bool'|'Int'|'Nat') ['in' integer '..' integer]
        '=' expr ';' ;
event = 'event' name 'when' expr '{' { name '=' expr ';' } '}' ;
invariant = 'invariant' name '=' expr ';' ;
```

`for i in N` is a cardinality loop, not list iteration; `for i in list`
uses the list bound. Integer cardinality loops bind a Nat index; list loops bind an element. Bounded collection types and symbolic Nat
parameters use `bound parameter <= integer`. Result errors are a named union;
Ok carries its success payload. Unit is `unit`. No implicit exceptions.
Effects are qualified service tokens such as `remote.Payments` or `state.file`.
Resource parameters use `take f: File`; initial state is the resource's initial
state. `settles f on (Ok, ParseError, Cancelled)` is a trusted abstract contract.
Machine event guards and assignment RHSs use pre-state values; unassigned
variables keep their values. Enabled events are nondeterministic. Deadlock
stutters explicitly; safety only. Out-of-domain assignments are model errors,
not silently disabled events. Bounds must be supplied by the author.

`creates result` marks fresh direct/Result-wrapped owned resources from an abstract
operation. A protocol links an abstract operation to an ordinary finite machine.
Its submit event occurs at the call; other machine events interleave, including
beyond cancellation/return. Enabled outcome guards permit response observation in
a separate step. The bounded first slice supports parameterless, non-resource
protocol operations and one shared instance per referenced machine. Protocol
machine state is visible to its outcome guards/results, not to normal flow bodies.

`fmt` normalises indentation, trailing whitespace and line endings to LF. It
preserves tokens and comment text and retains at most one blank line between
source lines. It rejects syntax errors rather than rewriting recovery holes.
It does not reorder the AST; some spacing inside lines remains as authored.

An abstract operation with external service effects requires either a linked
protocol or the explicit `atomic` metadata before behavioural lowering. `atomic`
is a recorded modelling assumption, never an established implementation fact.
Resource handle creation/settlement contracts are the documented local exception.
