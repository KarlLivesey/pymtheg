| Pin | Edit | CPU s | process start and module load | tree hash and snapshot | stored inputs read | parse | analysis (language) | resolution (language) | store writes and completion | other |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| honojs_hono | warm | 0.9 | 0.6 | 0.3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| honojs_hono | body | 50.9 | 0.6 | 0.6 | 3.2 | 0.0 | 42.5 | 1.2 | 2.4 | 0.4 |
| honojs_hono | export | 46.2 | 0.6 | 0.5 | 3.2 | 0.0 | 39.6 | 1.0 | 1.0 | 0.4 |
| vitest-dev_vitest | warm | 1.7 | 0.6 | 0.9 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.1 |
| vitest-dev_vitest | body | 122.6 | 0.6 | 2.6 | 5.7 | 0.0 | 109.0 | 1.3 | 2.4 | 0.9 |
| vitest-dev_vitest | export | 128.3 | 0.6 | 2.7 | 6.0 | 0.0 | 114.3 | 1.5 | 2.2 | 1.0 |
| restic_restic | warm | 0.9 | 0.6 | 0.3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| restic_restic | body | 5.2 | 0.5 | 0.7 | 1.2 | 0.1 | 1.3 | 0.9 | 0.2 | 0.3 |
| restic_restic | export | 13.8 | 0.6 | 0.7 | 3.6 | 0.1 | 4.4 | 3.4 | 0.6 | 0.4 |
| cli_cli | warm | 1.2 | 0.6 | 0.5 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| cli_cli | body | 13.0 | 0.6 | 1.4 | 4.8 | 0.2 | 2.8 | 2.2 | 0.2 | 0.9 |
| cli_cli | export | 33.8 | 0.6 | 1.4 | 12.4 | 0.2 | 9.4 | 7.4 | 1.2 | 1.3 |
| helix-editor_helix | warm | 0.8 | 0.6 | 0.3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| helix-editor_helix | body | 54.6 | 0.6 | 0.6 | 5.9 | 0.6 | 22.9 | 21.9 | 1.3 | 0.8 |
| helix-editor_helix | export | 51.8 | 0.6 | 0.6 | 5.9 | 0.6 | 21.2 | 21.0 | 1.1 | 0.8 |
| DioxusLabs_dioxus | warm | 1.2 | 0.6 | 0.5 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| DioxusLabs_dioxus | body | 429.1 | 0.6 | 1.4 | 10.9 | 0.2 | 208.9 | 203.9 | 1.8 | 1.3 |
| DioxusLabs_dioxus | export | 446.4 | 0.6 | 1.2 | 11.6 | 0.3 | 205.5 | 224.1 | 1.6 | 1.5 |

| Pin | Edit | filesHashed | filesParsed | analysisInputFiles | tsPrograms | tsFilesExtracted | goDecisionFiles | resolverInputLinks | recordsDecoded | filesWritten | sqlStatements |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| honojs_hono | warm | 506 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| honojs_hono | body | 1518 | 0 | 460 | 24 | 650 | 0 | 72340 | 461 | 18 | 17659 |
| honojs_hono | export | 1518 | 0 | 460 | 24 | 650 | 0 | 72341 | 461 | 2 | 1425 |
| vitest-dev_vitest | warm | 2642 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| vitest-dev_vitest | body | 7926 | 0 | 2490 | 50 | 3815 | 0 | 116220 | 2494 | 7 | 6975 |
| vitest-dev_vitest | export | 7926 | 0 | 2490 | 50 | 3815 | 0 | 116221 | 2494 | 2 | 2790 |
| restic_restic | warm | 560 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| restic_restic | body | 1680 | 1 | 559 | 0 | 0 | 1 | 20 | 560 | 1 | 725 |
| restic_restic | export | 1680 | 1 | 559 | 0 | 0 | 545 | 62346 | 714 | 1 | 883 |
| cli_cli | warm | 1199 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| cli_cli | body | 3597 | 1 | 1191 | 0 | 0 | 1 | 9331 | 1192 | 1 | 1420 |
| cli_cli | export | 3597 | 1 | 1191 | 0 | 0 | 724 | 148113 | 1524 | 1 | 1756 |
| helix-editor_helix | warm | 286 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| helix-editor_helix | body | 858 | 1 | 269 | 0 | 0 | 0 | 90458 | 554 | 2 | 1420 |
| helix-editor_helix | export | 858 | 1 | 269 | 0 | 0 | 0 | 90459 | 554 | 2 | 1426 |
| DioxusLabs_dioxus | warm | 1087 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| DioxusLabs_dioxus | body | 3261 | 1 | 954 | 0 | 0 | 0 | 154438 | 1925 | 2 | 1157 |
| DioxusLabs_dioxus | export | 3261 | 1 | 954 | 0 | 0 | 0 | 154439 | 1925 | 2 | 1163 |

| Pin | Edit | Now CPU s | Without start, load and stored inputs | Floor (estimate) | Share of analysis and resolution kept in the floor |
|---|---|--:|--:|--:|--:|
| honojs_hono | body | 50.9 | 47.0 | 3.1 | 0.15% |
| honojs_hono | export | 46.2 | 42.5 | 1.6 | 0.15% |
| vitest-dev_vitest | body | 122.6 | 116.2 | 5.0 | 0.03% |
| vitest-dev_vitest | export | 128.3 | 121.7 | 4.9 | 0.03% |
| restic_restic | body | 5.2 | 3.5 | 0.9 | 0.18% |
| restic_restic | export | 13.8 | 9.5 | 9.0 | 97.50% |
| cli_cli | body | 13.0 | 7.6 | 1.8 | 0.08% |
| cli_cli | export | 33.8 | 20.8 | 13.0 | 60.79% |
| helix-editor_helix | body | 54.6 | 48.1 | 2.7 | 0.37% |
| helix-editor_helix | export | 51.8 | 45.4 | 2.5 | 0.37% |
| DioxusLabs_dioxus | body | 429.1 | 417.6 | 3.9 | 0.10% |
| DioxusLabs_dioxus | export | 446.4 | 434.2 | 3.6 | 0.10% |
