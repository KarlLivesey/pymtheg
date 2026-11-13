# W2-F: Hints (mega-plan 7.7, 7.8; shortcomings S20, S21)

## 7.7 `check` says when behaviour was not checked (S20)

`check` text output now ends with a `BEHAVIOUR NOT CHECKED` notice whenever the
checked declarations include a machine. It states that `check` covers types,
effects and outcomes only, did not run machine events or test any invariant,
and that its results are not behavioural evidence. It then lists each machine
(up to five, then a count) with its invariant count and the exact
`pymtheg verify FILE --entry NAME` command. When `check` found errors it says to
fix them first.

- No notice when the checked scope has no machine.
- Machines are those `check` reported a `types-effects-outcomes` result for, so
  related-file consumers excluded from the selected status are not listed.
- Each command is valid POSIX shell as printed: any path or name that is not a
  plain word is single-quoted, so `$`, backticks, quotes, spaces and a leading
  `=` (which zsh expands) paste correctly.
- A saved scenario belongs to one entry of the checked file and carries that
  entry's scope. If `check` was run with `--scenario S`, only the command for
  the machine that is the scenario's own `entry` (as saved in
  `.pymtheg/settings.json`, whatever `--entry` was given to `check`) keeps
  `--scenario S`. That command names the checked file, which is also correct
  when the machine is imported into it. Every other machine is printed
  without `--scenario`, and so is every machine when the scenario's entry is a
  flow, or when its name does not pick out exactly one declaration in the
  checked file and its imports.
- Text output only (manager ruling, PR 21 round 1): JSON reports, `--out`
  reports, MCP and Studio are unchanged. No result, outcome or exit status
  changes.
- Not covered: flows with `assert` are also verifiable but are not listed.
  Their absence from the notice is not a claim that they were checked.

Support-matrix note for the ledger: "Creating a model or passing local checks
does not establish behavioural safety" is now also printed by `check`.

## 7.8 Hint for `Nat` subtraction (S21)

A T002 `Expected Nat, got Int` caused by a subtraction (directly, in brackets or
inside further `+`/`-`/`*` arithmetic) now gives the reason and a fix:

- Reason: `Subtracting from a Nat gives an Int, because the result may be below
  zero.` If the left side was already Int, it says instead: `The result of this
  subtraction is Int, and the target is Nat.`
- Fix for a machine state update: the complete replacement declaration in
  backticks, with the state's own range and initial value, for example
  ``Change Nat to Int in the declaration of n, keeping its range: `state n: Int in 0..3 = 3;` ``.
  Pasted in place of the old declaration, it checks.
- Fix elsewhere: ``If the value can go below zero, change Nat to Int in its
  declaration. For machine state, keep a finite range, for example `state count: Int in 0..3 = 0;`.``

The message keeps its `Expected Nat, got Int` prefix. Other T002 messages are
unchanged. The hint is part of the diagnostic message, so it also appears in
JSON reports, which the manager accepted in PR 21 round 1 so agents reading JSON
get it. `findingPresenter` (explain) gives these findings a dedicated title and
next step. The typing rules do not change: `Nat - Nat` is still `Int`.
