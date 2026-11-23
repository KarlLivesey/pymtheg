# C-43 per-pin figures

Cold indexes of each pin, source-only and with the Rust toolchain route (rust-analyzer 1.98.1, offline, the measurement's own crate cache filled by `cargo fetch` and online `cargo metadata` on throwaway copies). Level 2 counts Rust links only (resolved, or a library target with a symbol); D20 library module links are given apart. Times and memory are observations.

## Level 2 and the route's state

| Pin | State | Rust links | Source-only Level 2 | of which assumption-marked | With the route | Toolchain-decided | Confirmed | Kept where different | Library module links (D20) | RA wall s | RA CPU s | RA peak MiB | Index wall s, source-only / route |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| DioxusLabs_dioxus | partial (build script of atk-sys did not finish) | 150,404 | 73,311 (48.74%) | 3,668 | 73,311 (48.74%) | 0 | 0 | 0 | 0 | 518.4 | 1363.9 | 9721 | 556.5 / 1814.3 |
| helix-editor_helix | used | 90,583 | 40,673 (44.9%) | 2,491 | 51,733 (57.11%) | 11,060 | 13,849 | 0 | 0 | 136.5 | 1163.8 | 2458 | 93.1 / 382.8 |
| tauri-apps_tauri | partial (build script of atk-sys did not finish) | 88,113 | 42,580 (48.32%) | 3,401 | 42,580 (48.32%) | 0 | 0 | 0 | 0 | 139.9 | 628.7 | 5197 | 148.1 / 599.6 |
| actix_actix-web | used | 86,640 | 36,227 (41.81%) | 3,111 | 46,885 (54.11%) | 10,658 | 10,047 | 0 | 0 | 118.9 | 319.8 | 3022 | 84 / 337.7 |
| cberner_redb | used | 73,731 | 35,223 (47.77%) | 110 | 43,936 (59.59%) | 8,713 | 9,882 | 0 | 0 | 157 | 2066.2 | 2054 | 64.9 / 297.5 |
| rustls_rustls | used | 70,802 | 23,060 (32.57%) | 299 | 29,139 (41.16%) | 6,079 | 6,554 | 0 | 0 | 113.7 | 503.8 | 2352 | 117.8 / 299.3 |
| clap-rs_clap | used | 60,489 | 20,474 (33.85%) | 41 | 34,002 (56.21%) | 13,528 | 4,485 | 0 | 0 | 44.9 | 80.9 | 1673 | 50 / 131.8 |
| ratatui_ratatui | used | 60,424 | 25,892 (42.85%) | 1,793 | 39,351 (65.12%) | 13,459 | 10,488 | 0 | 0 | 75.8 | 304.2 | 2834 | 67.8 / 221.9 |
| tree-sitter_tree-sitter | used | 54,645 | 25,212 (46.14%) | 2,914 | 30,802 (56.37%) | 5,590 | 8,248 | 0 | 0 | 70.2 | 167.4 | 1645 | 60.5 / 200.4 |
| tokio-rs_axum | used | 41,067 | 16,583 (40.38%) | 1,144 | 19,273 (46.93%) | 2,690 | 2,720 | 0 | 0 | 42.1 | 95.4 | 1955 | 40.4 / 145.6 |
| BurntSushi_ripgrep | used | 39,819 | 26,307 (66.07%) | 1 | 29,922 (75.15%) | 3,615 | 9,724 | 0 | 0 | 26 | 50.8 | 1201 | 38.9 / 80.4 |
| crossbeam-rs_crossbeam | used | 34,081 | 19,138 (56.15%) | 0 | 21,611 (63.41%) | 2,474 | 3,546 | 0 | 0 | 48 | 62.3 | 1250 | 35.7 / 105.6 |
| alacritty_alacritty | partial (build script of crossfont did not finish) | 31,393 | 15,477 (49.3%) | 252 | 15,477 (49.3%) | 0 | 0 | 0 | 0 | 36.5 | 93.9 | 1686 | 29.2 / 102.7 |
| serde-rs_serde | used | 30,714 | 8,297 (27.01%) | 0 | 9,170 (29.86%) | 873 | 584 | 0 | 0 | 26.5 | 47.1 | 1146 | 40.1 / 94.9 |
| rust-lang_mdBook | used | 13,866 | 7,263 (52.38%) | 404 | 8,168 (58.91%) | 905 | 2,030 | 0 | 0 | 35.9 | 140.7 | 1904 | 28.2 / 133.1 |
| fjall-rs_fjall | used | 13,361 | 6,072 (45.45%) | 97 | 7,948 (59.49%) | 1,876 | 1,438 | 0 | 0 | 17.3 | 30.6 | 1097 | 13.6 / 49.4 |
| RustCrypto_hashes | used | 12,911 | 6,414 (49.68%) | 301 | 6,782 (52.53%) | 368 | 1,556 | 0 | 0 | 37.3 | 42.5 | 937 | 11.7 / 94.3 |
| rust-embedded_cortex-m | used | 5,531 | 3,347 (60.51%) | 7 | 3,511 (63.48%) | 164 | 552 | 0 | 0 | 19 | 41.7 | 926 | 7.6 / 44.9 |
| **18 pins** | 15 used | 958,574 | 431,550 (45.02%) | 20,034 | 513,601 (53.58%) | 82,052 | 85,703 | 0 | 0 | | | | |
| **15 used pins** | | 688,664 | 43.59% | | 55.50% | | | | | | | | |

No pin lost a source-only link or changed a source-only Level 2 link (`check` in each pin's JSON).

## Where the links source-only leaves open go (used pins)

Each open link is counted in the first bucket that applies (funnel.mjs). C-19 columns are C-19's own strict join on the same pins (evidence/c-19/joins), at the commit it measured: its checkout gain credited local bindings to their enclosing item, and its library gain is the part this first PR does not apply.

| Pin | Open after source-only | No answer at the name site | Gate: kind/namespace | Gate: known error classes | Gate: trait-method declaration | Gate: cfg other than test | Gate: cfg-variant guard | Gate: module twin, or module conditions unseen (review) | Gate: conditional candidates (review) | Gate: library/outside set kept | No identity: library item | of which pass the cfg gate | No identity: generated item | No identity: no graph symbol (fields…) | No identity: local binding | Credited | C-19 checkout gain | C-19 library gain | C-19 gated | Route now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| helix-editor_helix | 49,651 | 4,357 | 51 | 40 | 1,558 | 80 | 66 | 0 | 320 | 0 | 23,187 | 22,556 | 505 | 473 | 7,954 | 11,060 | 19,518 | 25,034 | 90.96% | 57.11% |
| actix_actix-web | 49,944 | 4,507 | 272 | 61 | 1,358 | 1,285 | 69 | 0 | 2,677 | 0 | 22,834 | 20,387 | 1,040 | 1,241 | 3,942 | 10,658 | 19,439 | 24,639 | 84.82% | 54.11% |
| cberner_redb | 38,394 | 2,872 | 54 | 106 | 1,223 | 1,627 | 660 | 0 | 182 | 0 | 19,167 | 15,384 | 364 | 10 | 3,416 | 8,713 | 15,259 | 23,621 | 84.59% | 59.59% |
| rustls_rustls | 47,713 | 633 | 176 | 47 | 1,549 | 4,807 | 6,567 | 0 | 771 | 0 | 18,482 | 13,605 | 1,263 | 2,173 | 5,166 | 6,079 | 24,234 | 21,421 | 74.17% | 41.16% |
| clap-rs_clap | 39,979 | 4,978 | 21 | 454 | 1,234 | 3,254 | 444 | 572 | 781 | 0 | 12,185 | 10,654 | 363 | 0 | 2,165 | 13,528 | 16,761 | 10,837 | 83.1% | 56.21% |
| ratatui_ratatui | 34,256 | 2,963 | 69 | 25 | 1,400 | 239 | 9 | 0 | 314 | 0 | 9,794 | 9,496 | 1,279 | 601 | 4,104 | 13,459 | 18,261 | 12,691 | 87.96% | 65.12% |
| tree-sitter_tree-sitter | 29,425 | 1,568 | 31 | 17 | 1,114 | 310 | 69 | 0 | 93 | 0 | 13,662 | 12,986 | 745 | 53 | 6,173 | 5,590 | 13,032 | 15,362 | 90.3% | 56.37% |
| tokio-rs_axum | 24,208 | 10,635 | 34 | 44 | 459 | 111 | 340 | 0 | 1,002 | 0 | 6,748 | 6,514 | 197 | 611 | 1,325 | 2,690 | 5,515 | 7,354 | 68.68% | 46.93% |
| BurntSushi_ripgrep | 12,255 | 260 | 9 | 8 | 625 | 38 | 19 | 0 | 580 | 0 | 6,027 | 5,786 | 125 | 0 | 949 | 3,615 | 5,432 | 6,620 | 93.36% | 75.15% |
| crossbeam-rs_crossbeam | 14,929 | 586 | 39 | 185 | 227 | 405 | 61 | 18 | 4,110 | 0 | 6,449 | 6,155 | 54 | 12 | 310 | 2,473 | 7,454 | 8,272 | 94.18% | 63.41% |
| serde-rs_serde | 22,417 | 537 | 63 | 75 | 908 | 2,332 | 3,887 | 23 | 0 | 0 | 10,225 | 8,481 | 637 | 12 | 2,845 | 873 | 10,504 | 10,457 | 75.66% | 29.86% |
| rust-lang_mdBook | 6,570 | 164 | 6 | 3 | 346 | 4 | 2 | 0 | 12 | 0 | 4,595 | 4,572 | 38 | 0 | 495 | 905 | 1,009 | 4,597 | 95.25% | 58.91% |
| fjall-rs_fjall | 7,289 | 1,795 | 0 | 0 | 250 | 25 | 7 | 0 | 2 | 0 | 2,823 | 2,721 | 86 | 0 | 425 | 1,876 | 2,336 | 3,114 | 82.2% | 59.49% |
| RustCrypto_hashes | 6,412 | 2,419 | 5 | 26 | 121 | 0 | 4 | 199 | 0 | 0 | 2,341 | 2,317 | 20 | 131 | 778 | 368 | 1,349 | 2,716 | 78.06% | 52.53% |
| rust-embedded_cortex-m | 2,171 | 972 | 6 | 51 | 37 | 49 | 47 | 0 | 10 | 0 | 736 | 635 | 0 | 0 | 99 | 164 | 375 | 1,055 | 76.33% | 63.48% |
| **15 used pins** | 385,613 | 39,246 | 836 | 1,142 | 12,409 | 14,566 | 12,251 | 812 | 10,854 | 0 | 159,255 | 142,249 | 6,716 | 5,317 | 40,146 | 82,051 | 160,478 | 177,790 | | |
