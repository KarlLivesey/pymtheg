# SW-3: a coverage scoreboard and support plan

The sweep can export every stored link outcome and its reason. The scoreboard
reports a raw score and an adjusted score that excludes targets with evidence
that they live outside the checkout. Unclassified links stay in the score.
Bundle files, broken fixtures, templates and attempts that did not finish are
visible in the results.

The coverage plan groups sampled source sites into support items and estimates
the points each could add. Missing graphs and failed files use line-based
estimates. The runner accepts a local build and can refresh a subset of the
pinned corpus so the scoreboard and plan show what moved.
