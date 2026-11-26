# C-61 evidence

- `pins-main-head.jsonl`: the 20 Go pins of `sweep/repos.json`, each indexed cold by main and by this build into stores with one project id, comparing every Go link. Per pin: Go links and Level 2 on each build, links that gained `localBinding`, links with the reason `local`, links whose `localBinding` target is not their own function or method (`wrongOwner`, 0), other changed links (0) and removed links (0).
- `audit-sample.txt`: 60 of the 8,578 new definite links, drawn with a fixed seed, each printed from the binding's declaration to the call, for reading against the source.
- `suite.txt`: the build, type check, format check, `npm test` and `npm run test:backend`.
