# W2-J: production-discovery test allows real languages

A10 in `test/graph-review.test.mjs` now asserts that production discovery returns no test-only module (so not `toy`), that test-mode discovery includes `toy` marked test-only, and that test mode minus production is exactly the test-only modules. It names no real language, so it holds with zero or more real language folders.
Evidence: `evidence/w2-j/` shows the test passing in a scratch `dist` with an added real language, and failing (`production offers toy`) when the toy's `testOnly` marker is removed.
