# SW-3: a coverage scoreboard and support plan

The sweep exports every stored link outcome and its reason. Completion has
its own checklist. Coverage uses measured links from finished checkouts,
with separate figures for bundles, broken fixtures and templates.

The source audit estimates how many remaining links target outside code,
how many need new support, and how many are ambiguous at run time. The plan
reports the raw score, the conservative strict score and a sample-corrected
score with an interval. It ranks support items by how much strict coverage
could improve in each language.

The runner accepts a local build and can refresh a subset of the pinned
corpus. The progress script recomputes completion, coverage, and the
support tables after a candidate run.
