# C-43 per-pin figures

Cold indexes of each pin, source-only and with the Rust toolchain route (rust-analyzer 1.98.1, offline, the measurement's own crate cache filled by `cargo fetch` and online `cargo metadata` on throwaway copies). Level 2 counts Rust links only (resolved, or a library target with a symbol); D20 library module links are given apart. Times and memory are observations.

## Level 2 and the route's state

| Pin | State | Rust links | Source-only Level 2 | of which assumption-marked | With the route | Toolchain checkout | Toolchain library (D24) | Confirmed | Kept where different | Library module links (D20) | RA wall s | RA CPU s | RA peak MiB | Index wall s, source-only / route |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| DioxusLabs_dioxus | partial (build script of atk-sys did not finish) | 150,404 | 73,311 (48.74%) | 3,668 | 73,311 (48.74%) | 0 | 0 | 0 | 0 | 0 | 507.3 | 1394.3 | 9721 | 844 / 1637.1 |
| helix-editor_helix | used | 90,583 | 40,673 (44.9%) | 2,491 | 73,601 (81.25%) | 11,060 | 21,868 | 13,849 | 0 | 0 | 167.9 | 1197.3 | 2447 | 144.8 / 652.7 |
| tauri-apps_tauri | partial (build script of atk-sys did not finish) | 88,113 | 42,580 (48.32%) | 3,401 | 42,580 (48.32%) | 0 | 0 | 0 | 0 | 0 | 125.8 | 617.1 | 5194 | 118.1 / 535.7 |
| actix_actix-web | used | 86,640 | 36,227 (41.81%) | 3,111 | 66,882 (77.2%) | 10,658 | 19,997 | 10,047 | 0 | 0 | 144.8 | 330.7 | 3010 | 136.3 / 561.5 |
| cberner_redb | used | 73,731 | 35,223 (47.77%) | 110 | 58,972 (79.98%) | 8,713 | 15,036 | 9,882 | 0 | 0 | 178.6 | 2086.3 | 2059 | 113.7 / 439.2 |
| rustls_rustls | used | 70,802 | 23,060 (32.57%) | 299 | 42,169 (59.56%) | 6,079 | 13,030 | 6,554 | 0 | 0 | 162.9 | 599.8 | 2360 | 183.3 / 511.8 |
| clap-rs_clap | used | 60,489 | 20,474 (33.85%) | 41 | 44,349 (73.32%) | 13,528 | 10,347 | 4,485 | 0 | 0 | 70.6 | 113.3 | 1668 | 75.1 / 225 |
| ratatui_ratatui | used | 60,424 | 25,892 (42.85%) | 1,793 | 48,603 (80.44%) | 13,459 | 9,252 | 10,488 | 0 | 0 | 103.3 | 374.8 | 2833 | 111.8 / 327.9 |
| tree-sitter_tree-sitter | used | 54,645 | 25,212 (46.14%) | 2,914 | 43,399 (79.42%) | 5,590 | 12,597 | 8,248 | 0 | 0 | 68.3 | 167.8 | 1651 | 101 / 198.2 |
| tokio-rs_axum | used | 41,067 | 16,583 (40.38%) | 1,144 | 25,702 (62.59%) | 2,690 | 6,429 | 2,720 | 0 | 0 | 52.3 | 111.8 | 1945 | 68.4 / 231.4 |
| BurntSushi_ripgrep | used | 39,819 | 26,307 (66.07%) | 1 | 35,566 (89.32%) | 3,615 | 5,644 | 9,724 | 0 | 0 | 43.2 | 72.8 | 1204 | 52.3 / 159.5 |
| crossbeam-rs_crossbeam | used | 34,081 | 19,138 (56.15%) | 0 | 27,747 (81.41%) | 2,474 | 6,136 | 3,546 | 0 | 0 | 45.1 | 60 | 1245 | 42 / 99.4 |
| alacritty_alacritty | partial (build script of crossfont did not finish) | 31,393 | 15,477 (49.3%) | 252 | 15,477 (49.3%) | 0 | 0 | 0 | 0 | 0 | 29.4 | 79.1 | 1686 | 23.1 / 88.7 |
| serde-rs_serde | used | 30,714 | 8,297 (27.01%) | 0 | 17,564 (57.19%) | 873 | 8,394 | 584 | 0 | 0 | 38.6 | 62.1 | 1144 | 67.3 / 161.5 |
| rust-lang_mdBook | used | 13,866 | 7,263 (52.38%) | 404 | 12,585 (90.76%) | 905 | 4,417 | 2,030 | 0 | 0 | 34.4 | 136.2 | 1902 | 22.4 / 99.1 |
| fjall-rs_fjall | used | 13,361 | 6,072 (45.45%) | 97 | 10,598 (79.32%) | 1,876 | 2,650 | 1,438 | 0 | 0 | 26.6 | 42.6 | 1090 | 26.2 / 82 |
| RustCrypto_hashes | used | 12,911 | 6,414 (49.68%) | 301 | 8,926 (69.13%) | 368 | 2,144 | 1,556 | 0 | 0 | 62 | 67.2 | 929 | 14.2 / 192 |
| rust-embedded_cortex-m | used | 5,531 | 3,347 (60.51%) | 7 | 4,109 (74.29%) | 164 | 598 | 552 | 0 | 0 | 30.4 | 55.3 | 927 | 10.9 / 69.6 |
| **18 pins** | 15 used | 958,574 | 431,550 (45.02%) | 20,034 | 652,140 (68.03%) | 82,052 | 138,539 | 85,703 | 0 | 0 | | | | |
| **15 used pins** | | 688,664 | 43.59% | | 75.62% | | | | | | | | |

No pin lost a source-only link or changed a source-only Level 2 link (`check` in each pin's JSON).

## Where the links source-only leaves open go (used pins)

Each open link is counted in the first bucket that applies (funnel.mjs). C-19 columns are C-19's own strict join on the same pins (evidence/c-19/joins), at the commit it measured: its checkout gain credited local bindings to their enclosing item, and its library gain is the part this first PR does not apply.

| Pin | Open after source-only | No answer at the name site | Gate: kind/namespace | Gate: known error classes | Gate: trait-method declaration | Gate: cfg other than test | Gate: cfg-variant guard | Gate: cfg on an enclosing module (review) | Gate: conditional candidates (review) | Gate: library/outside set kept | No identity: library item | of which pass the cfg gate | No identity: generated item | No identity: no graph symbol (fields…) | No identity: local binding | Library: source-only target kept | Library: outside the candidate set | Credited: checkout | Credited: library (D24) | C-19 checkout gain | C-19 library gain | C-19 gated | Route now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| helix-editor_helix | 49,651 | 4,357 | 51 | 40 | 1,558 | 687 | 50 | 336 | 0 | 0 | 712 | 688 | 505 | 473 | 7,954 | 0 | 0 | 11,060 | 21,868 | 19,518 | 25,034 | 90.96% | 81.25% |
| actix_actix-web | 49,944 | 4,507 | 272 | 61 | 1,358 | 3,705 | 30 | 2,695 | 21 | 0 | 417 | 390 | 1,040 | 1,241 | 3,942 | 0 | 0 | 10,658 | 19,997 | 19,439 | 24,639 | 84.82% | 77.2% |
| cberner_redb | 38,394 | 2,872 | 54 | 106 | 1,223 | 5,395 | 660 | 151 | 31 | 0 | 363 | 348 | 364 | 10 | 3,416 | 0 | 0 | 8,713 | 15,036 | 15,259 | 23,621 | 84.59% | 79.98% |
| rustls_rustls | 47,713 | 633 | 176 | 47 | 1,549 | 9,395 | 6,567 | 604 | 167 | 0 | 864 | 575 | 1,263 | 2,173 | 5,166 | 0 | 0 | 6,079 | 13,030 | 24,234 | 21,421 | 74.17% | 59.56% |
| clap-rs_clap | 39,979 | 4,978 | 21 | 454 | 1,234 | 4,760 | 404 | 1,313 | 80 | 0 | 332 | 307 | 363 | 0 | 2,165 | 0 | 0 | 13,528 | 10,347 | 16,761 | 10,837 | 83.1% | 73.32% |
| ratatui_ratatui | 34,256 | 2,963 | 69 | 25 | 1,400 | 533 | 9 | 270 | 44 | 0 | 248 | 244 | 1,279 | 601 | 4,104 | 0 | 0 | 13,459 | 9,252 | 18,261 | 12,691 | 87.96% | 80.44% |
| tree-sitter_tree-sitter | 29,425 | 1,568 | 31 | 17 | 1,114 | 942 | 69 | 93 | 0 | 0 | 433 | 389 | 745 | 53 | 6,173 | 0 | 0 | 5,590 | 12,597 | 13,032 | 15,362 | 90.3% | 79.42% |
| tokio-rs_axum | 24,208 | 10,635 | 34 | 44 | 459 | 345 | 331 | 995 | 16 | 0 | 85 | 85 | 197 | 611 | 1,325 | 0 | 0 | 2,690 | 6,429 | 5,515 | 7,354 | 68.68% | 62.59% |
| BurntSushi_ripgrep | 12,255 | 260 | 9 | 8 | 625 | 275 | 19 | 579 | 1 | 0 | 146 | 142 | 125 | 0 | 949 | 0 | 0 | 3,615 | 5,644 | 5,432 | 6,620 | 93.36% | 89.32% |
| crossbeam-rs_crossbeam | 14,929 | 586 | 39 | 185 | 227 | 698 | 61 | 3,731 | 397 | 0 | 20 | 19 | 54 | 12 | 310 | 0 | 0 | 2,473 | 6,136 | 7,454 | 8,272 | 94.18% | 81.41% |
| serde-rs_serde | 22,417 | 537 | 63 | 75 | 908 | 4,071 | 3,887 | 23 | 0 | 0 | 92 | 87 | 637 | 12 | 2,845 | 0 | 0 | 873 | 8,394 | 10,504 | 10,457 | 75.66% | 57.19% |
| rust-lang_mdBook | 6,570 | 164 | 6 | 3 | 346 | 27 | 2 | 12 | 0 | 0 | 155 | 155 | 38 | 0 | 495 | 0 | 0 | 905 | 4,417 | 1,009 | 4,597 | 95.25% | 90.76% |
| fjall-rs_fjall | 7,289 | 1,795 | 0 | 0 | 250 | 127 | 7 | 2 | 0 | 0 | 71 | 71 | 86 | 0 | 425 | 0 | 0 | 1,876 | 2,650 | 2,336 | 3,114 | 82.2% | 79.32% |
| RustCrypto_hashes | 6,412 | 2,419 | 5 | 26 | 121 | 24 | 1 | 202 | 0 | 0 | 173 | 173 | 20 | 131 | 778 | 0 | 0 | 368 | 2,144 | 1,349 | 2,716 | 78.06% | 69.13% |
| rust-embedded_cortex-m | 2,171 | 972 | 6 | 51 | 37 | 150 | 9 | 48 | 0 | 0 | 37 | 37 | 0 | 0 | 99 | 0 | 0 | 164 | 598 | 375 | 1,055 | 76.33% | 74.29% |
| **15 used pins** | 385,613 | 39,246 | 836 | 1,142 | 12,409 | 31,134 | 12,106 | 11,054 | 757 | 0 | 4,148 | 3,710 | 6,716 | 5,317 | 40,146 | 0 | 0 | 82,051 | 138,539 | 160,478 | 177,790 | | |
