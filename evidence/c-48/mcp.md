## Persistent worker (this change)
| Pin | Edit | CPU s | process start and module load | tree hash and snapshot | stored inputs read | parse | analysis (language) | resolution (language) | store writes and completion | other |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| restic_restic | cold | 42.4 | 0.1 | 1.0 | 3.7 | 4.5 | 4.4 | 3.4 | 23.7 | 1.6 |
| restic_restic | warm | 0.3 | 0.0 | 0.2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| restic_restic | body | 3.6 | 0.0 | 0.8 | 1.0 | 0.0 | 0.9 | 0.6 | 0.1 | 0.3 |
| restic_restic | body-revert | 2.9 | 0.0 | 0.6 | 0.9 | 0.0 | 0.6 | 0.5 | 0.1 | 0.3 |
| restic_restic | export | 12.4 | 0.0 | 0.7 | 3.5 | 0.0 | 4.1 | 3.2 | 0.6 | 0.4 |
| restic_restic | export-revert | 10.8 | 0.0 | 0.6 | 3.6 | 0.0 | 3.0 | 2.8 | 0.5 | 0.4 |
| cli_cli | cold | 148.5 | 0.1 | 1.6 | 14.6 | 12.6 | 18.8 | 9.2 | 88.1 | 3.5 |
| cli_cli | warm | 0.4 | 0.0 | 0.4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| cli_cli | body | 10.6 | 0.0 | 1.5 | 4.5 | 0.0 | 1.7 | 1.8 | 0.2 | 0.9 |
| cli_cli | body-revert | 10.0 | 0.0 | 1.4 | 4.4 | 0.0 | 1.5 | 1.6 | 0.2 | 0.9 |
| cli_cli | export | 27.0 | 0.0 | 1.3 | 11.1 | 0.0 | 6.2 | 6.3 | 0.9 | 1.2 |
| cli_cli | export-revert | 26.7 | 0.0 | 1.3 | 10.9 | 0.0 | 6.5 | 5.9 | 0.9 | 1.1 |
| honojs_hono | cold | 62.4 | 0.1 | 0.7 | 2.7 | 0.0 | 41.2 | 1.1 | 15.6 | 1.0 |
| honojs_hono | warm | 0.2 | 0.0 | 0.2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| honojs_hono | body | 34.1 | 0.0 | 0.5 | 3.4 | 0.0 | 26.3 | 1.1 | 2.5 | 0.4 |
| honojs_hono | body-revert | 32.3 | 0.0 | 0.5 | 3.6 | 0.0 | 24.3 | 0.9 | 2.7 | 0.4 |
| honojs_hono | export | 30.6 | 0.0 | 0.5 | 3.6 | 0.0 | 23.9 | 1.1 | 1.0 | 0.5 |
| honojs_hono | export-revert | 30.4 | 0.0 | 0.9 | 3.5 | 0.0 | 23.5 | 1.0 | 1.0 | 0.5 |
| helix-editor_helix | cold | 122.0 | 0.1 | 1.0 | 7.5 | 40.2 | 24.2 | 20.6 | 26.7 | 1.8 |
| helix-editor_helix | warm | 0.2 | 0.0 | 0.2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| helix-editor_helix | body | 53.8 | 0.0 | 0.7 | 7.2 | 0.2 | 21.6 | 21.1 | 1.3 | 1.7 |
| helix-editor_helix | body-revert | 51.8 | 0.0 | 0.6 | 6.5 | 0.1 | 21.6 | 20.4 | 1.2 | 1.3 |
| helix-editor_helix | export | 52.4 | 0.0 | 0.6 | 6.6 | 0.1 | 20.9 | 21.6 | 1.2 | 1.2 |
| helix-editor_helix | export-revert | 51.4 | 0.0 | 0.7 | 6.5 | 0.1 | 21.1 | 20.5 | 1.2 | 1.2 |

| Pin | Edit | filesHashed | filesParsed | analysisInputFiles | tsPrograms | tsFilesExtracted | goDecisionFiles | resolverInputLinks | recordsDecoded | filesWritten | sqlStatements |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| restic_restic | cold | 1680 | 559 | 559 | 0 | 0 | 559 | 63330 | 1279 | 953 | 263546 |
| restic_restic | warm | 560 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| restic_restic | body | 1680 | 1 | 559 | 0 | 0 | 1 | 20 | 560 | 1 | 725 |
| restic_restic | body-revert | 1680 | 1 | 559 | 0 | 0 | 1 | 20 | 560 | 1 | 725 |
| restic_restic | export | 1680 | 1 | 559 | 0 | 0 | 545 | 62346 | 714 | 1 | 883 |
| restic_restic | export-revert | 1680 | 1 | 559 | 0 | 0 | 545 | 62345 | 714 | 1 | 880 |
| cli_cli | cold | 3597 | 1127 | 1191 | 0 | 0 | 1127 | 216644 | 2862 | 2156 | 843529 |
| cli_cli | warm | 1199 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| cli_cli | body | 3597 | 1 | 1191 | 0 | 0 | 1 | 9331 | 1192 | 1 | 1420 |
| cli_cli | body-revert | 3597 | 1 | 1191 | 0 | 0 | 1 | 9331 | 1192 | 1 | 1420 |
| cli_cli | export | 3597 | 1 | 1191 | 0 | 0 | 724 | 148113 | 1524 | 1 | 1756 |
| cli_cli | export-revert | 3597 | 1 | 1191 | 0 | 0 | 724 | 148112 | 1524 | 1 | 1753 |
| honojs_hono | cold | 1518 | 0 | 460 | 0 | 0 | 0 | 72340 | 460 | 920 | 203068 |
| honojs_hono | warm | 506 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| honojs_hono | body | 1518 | 0 | 460 | 0 | 0 | 0 | 72340 | 461 | 18 | 17659 |
| honojs_hono | body-revert | 1518 | 0 | 460 | 0 | 0 | 0 | 72340 | 461 | 18 | 17659 |
| honojs_hono | export | 1518 | 0 | 460 | 0 | 0 | 0 | 72341 | 461 | 2 | 1425 |
| honojs_hono | export-revert | 1518 | 0 | 460 | 0 | 0 | 0 | 72340 | 461 | 2 | 1422 |
| helix-editor_helix | cold | 858 | 255 | 269 | 0 | 0 | 4 | 90504 | 824 | 536 | 276108 |
| helix-editor_helix | warm | 286 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| helix-editor_helix | body | 858 | 1 | 269 | 0 | 0 | 0 | 90458 | 554 | 2 | 1420 |
| helix-editor_helix | body-revert | 858 | 1 | 269 | 0 | 0 | 0 | 90458 | 554 | 2 | 1420 |
| helix-editor_helix | export | 858 | 1 | 269 | 0 | 0 | 0 | 90459 | 554 | 2 | 1426 |
| helix-editor_helix | export-revert | 858 | 1 | 269 | 0 | 0 | 0 | 90458 | 554 | 2 | 1421 |

## Jobs, wall and CPU ms, resting RSS MiB after each step, peak
mcp-before restic_restic cold 40318/43479 rss 834; warm 729/905 rss 826; body 3027/4634 rss 827; body-revert 3118/4660 rss 829; export 8834/13884 rss 729; export-revert 9402/14469 rss 732 ; peak 878
mcp-before cli_cli cold 197401/175859 rss 1358; warm 970/1151 rss 1350; body 9252/12174 rss 701; body-revert 9555/12830 rss 730; export 24643/33146 rss 1152; export-revert 24896/33006 rss 1108 ; peak 1490
mcp-before honojs_hono cold 42645/60194 rss 1221; warm 799/995 rss 1204; body 29954/50671 rss 1178; body-revert 27331/47453 rss 1195; export 25414/46782 rss 1173; export-revert 24053/45616 rss 1456 ; peak 1568
mcp-before helix-editor_helix cold 135346/138704 rss 1381; warm 1280/1200 rss 1374; body 34522/46388 rss 1286; body-revert 35053/46564 rss 1595; export 32030/44842 rss 1296; export-revert 31878/44378 rss 1293 ; peak 1697
mcp-after restic_restic cold 54944/42444 rss 376; warm 225/250 rss 376; body 3286/3600 rss 550; body-revert 2892/2905 rss 553; export 9630/12412 rss 871; export-revert 8383/10831 rss 887 ; peak 928
mcp-after cli_cli cold 158234/148476 rss 1369; warm 394/437 rss 1369; body 8598/10586 rss 1372; body-revert 8835/10035 rss 1372; export 23115/26972 rss 1371; export-revert 22260/26731 rss 1372 ; peak 1477
mcp-after honojs_hono cold 53940/62370 rss 1302; warm 184/217 rss 1303; body 26210/34132 rss 2252; body-revert 26841/32336 rss 2603; export 25147/30617 rss 2603; export-revert 25951/30388 rss 2564 ; peak 2696
mcp-after helix-editor_helix cold 105792/122037 rss 1264; warm 170/195 rss 1264; body 37044/53846 rss 1403; body-revert 36266/51823 rss 1395; export 37148/52386 rss 1410; export-revert 36205/51371 rss 1411 ; peak 1493
mcp-with40 honojs_hono cold 35113/52636 rss 1089; warm 166/192 rss 1090; body 23697/36083 rss 1048; body-revert 22593/32927 rss 1084; export 21960/32839 rss 1336; export-revert 24442/28650 rss 2327 ; peak 2345
