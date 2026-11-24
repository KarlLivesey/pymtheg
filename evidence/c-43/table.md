# C-43 per-pin figures

Cold indexes of each pin, source-only and with the Rust toolchain route (rust-analyzer 1.98.1, offline, the measurement's own crate cache filled by `cargo fetch` and online `cargo metadata` on throwaway copies). Level 2 counts Rust links only (resolved, or a library target with a symbol); D20 library module links are given apart. Times and memory are observations.

## Level 2 and the route's state

| Pin | State | Rust links | Source-only Level 2 | of which assumption-marked | With the route | Toolchain-decided | Confirmed | Kept where different | Library module links (D20) | RA wall s | RA CPU s | RA peak MiB | Index wall s, source-only / route |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| DioxusLabs_dioxus | partial (build script of atk-sys did not finish) | 150,404 | 73,311 (48.74%) | 3,668 | 73,311 (48.74%) | 0 | 0 | 0 | 0 | 380.5 | 1158.1 | 9739 | 557.7 / 1424.4 |
| helix-editor_helix | used | 90,583 | 40,673 (44.9%) | 2,491 | 42,583 (47.01%) | 1,910 | 13,924 | 0 | 0 | 110.1 | 1064.4 | 2457 | 76.6 / 286.4 |
| tauri-apps_tauri | partial (build script of atk-sys did not finish) | 88,113 | 42,580 (48.32%) | 3,401 | 42,580 (48.32%) | 0 | 0 | 0 | 0 | 139.1 | 596.4 | 5188 | 89.3 / 648.4 |
| actix_actix-web | used | 86,640 | 36,227 (41.81%) | 3,111 | 37,503 (43.29%) | 1,276 | 10,076 | 0 | 0 | 117.9 | 320.4 | 3042 | 73.1 / 270 |
| cberner_redb | used | 73,731 | 35,223 (47.77%) | 110 | 35,708 (48.43%) | 485 | 9,882 | 0 | 0 | 158.3 | 1978.8 | 2060 | 57.6 / 293.5 |
| rustls_rustls | used | 70,802 | 23,060 (32.57%) | 299 | 25,051 (35.38%) | 1,991 | 6,667 | 0 | 0 | 103.5 | 477.8 | 2381 | 112.7 / 267.8 |
| clap-rs_clap | used | 60,489 | 20,474 (33.85%) | 41 | 24,606 (40.68%) | 4,132 | 4,569 | 0 | 0 | 44.5 | 79.6 | 1669 | 44.2 / 139.8 |
| ratatui_ratatui | used | 60,424 | 25,892 (42.85%) | 1,793 | 27,396 (45.34%) | 1,504 | 10,488 | 0 | 0 | 79.5 | 275.6 | 2856 | 62.1 / 259.3 |
| tree-sitter_tree-sitter | used | 54,645 | 25,212 (46.14%) | 2,914 | 25,334 (46.36%) | 122 | 8,328 | 0 | 0 | 53.5 | 128.2 | 1655 | 51.2 / 146.6 |
| tokio-rs_axum | used | 41,067 | 16,583 (40.38%) | 1,144 | 16,928 (41.22%) | 345 | 2,835 | 0 | 0 | 37.3 | 83.8 | 1953 | 36.4 / 140.9 |
| BurntSushi_ripgrep | used | 39,819 | 26,307 (66.07%) | 1 | 27,734 (69.65%) | 1,427 | 9,724 | 0 | 0 | 25.2 | 45.6 | 1205 | 30.3 / 82.2 |
| crossbeam-rs_crossbeam | used | 34,081 | 19,138 (56.15%) | 0 | 19,260 (56.51%) | 122 | 3,558 | 0 | 0 | 39.6 | 52.3 | 1250 | 30 / 86.1 |
| alacritty_alacritty | partial (build script of crossfont did not finish) | 31,393 | 15,477 (49.3%) | 252 | 15,477 (49.3%) | 0 | 0 | 0 | 0 | 36.8 | 92.2 | 1690 | 28.2 / 113.6 |
| serde-rs_serde | used | 30,714 | 8,297 (27.01%) | 0 | 8,484 (27.62%) | 187 | 591 | 0 | 0 | 26.3 | 46.7 | 1147 | 36.8 / 116.1 |
| rust-lang_mdBook | used | 13,866 | 7,263 (52.38%) | 404 | 7,637 (55.08%) | 374 | 2,030 | 0 | 0 | 26.1 | 104.3 | 1898 | 20.5 / 86.2 |
| fjall-rs_fjall | used | 13,361 | 6,072 (45.45%) | 97 | 6,136 (45.92%) | 64 | 1,438 | 0 | 0 | 17.2 | 29.8 | 1099 | 14.1 / 52.1 |
| RustCrypto_hashes | used | 12,911 | 6,414 (49.68%) | 301 | 6,639 (51.42%) | 225 | 1,615 | 0 | 0 | 41.1 | 47 | 935 | 11.7 / 131.7 |
| rust-embedded_cortex-m | used | 5,531 | 3,347 (60.51%) | 7 | 3,389 (61.27%) | 42 | 581 | 0 | 0 | 15.7 | 35.2 | 924 | 8.2 / 41.3 |
| **18 pins** | 15 used | 958,574 | 431,550 (45.02%) | 20,034 | 445,756 (46.50%) | 14,206 | 86,306 | 0 | 0 | | | | |
| **15 used pins** | | 688,664 | 43.59% | | 45.65% | | | | | | | | |

No pin lost a source-only link or changed a source-only Level 2 link (`check` in each pin's JSON).

## Where the links source-only leaves open go (used pins)

Each open link is counted in the first bucket that applies (funnel.mjs). C-19 columns are C-19's own strict join on the same pins (evidence/c-19/joins), at the commit it measured: its checkout gain credited local bindings to their enclosing item, and its library gain is the part this first PR does not apply.

| Pin | Open after source-only | No answer at the name site | Gate: kind/namespace | Gate: known error classes | Gate: trait-method declaration | Gate: cfg other than test | Gate: cfg-variant guard | Gate: module twin, or module conditions unseen (review) | Gate: conditional candidates (review) | Gate: library/outside set kept | No identity: library item | of which pass the cfg gate | No identity: generated item | No identity: no graph symbol (fields…) | No identity: local binding | Credited | C-19 checkout gain | C-19 library gain | C-19 gated | Route now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| helix-editor_helix | 49,651 | 4,357 | 51 | 40 | 1,558 | 80 | 0 | 0 | 0 | 0 | 23,187 | 22,556 | 505 | 473 | 7,954 | 1,910 | 19,518 | 25,034 | 90.96% | 47.01% |
| actix_actix-web | 49,944 | 4,507 | 272 | 61 | 1,358 | 1,285 | 0 | 0 | 0 | 0 | 22,834 | 20,387 | 1,040 | 1,241 | 3,942 | 1,276 | 19,439 | 24,639 | 84.82% | 43.29% |
| cberner_redb | 38,394 | 2,872 | 54 | 106 | 1,223 | 1,627 | 0 | 0 | 0 | 0 | 19,167 | 15,384 | 364 | 10 | 3,416 | 485 | 15,259 | 23,621 | 84.59% | 48.43% |
| rustls_rustls | 47,713 | 633 | 176 | 47 | 1,549 | 4,807 | 0 | 0 | 0 | 0 | 18,482 | 13,605 | 1,263 | 2,173 | 5,166 | 1,991 | 24,234 | 21,421 | 74.17% | 35.38% |
| clap-rs_clap | 39,979 | 4,978 | 21 | 454 | 1,234 | 3,254 | 0 | 0 | 0 | 0 | 12,185 | 10,654 | 363 | 0 | 2,165 | 4,132 | 16,761 | 10,837 | 83.1% | 40.68% |
| ratatui_ratatui | 34,256 | 2,963 | 69 | 25 | 1,400 | 239 | 0 | 0 | 0 | 0 | 9,794 | 9,496 | 1,279 | 601 | 4,104 | 1,504 | 18,261 | 12,691 | 87.96% | 45.34% |
| tree-sitter_tree-sitter | 29,425 | 1,568 | 31 | 17 | 1,114 | 310 | 0 | 0 | 0 | 0 | 13,662 | 12,986 | 745 | 53 | 6,173 | 122 | 13,032 | 15,362 | 90.3% | 46.36% |
| tokio-rs_axum | 24,208 | 10,635 | 34 | 44 | 459 | 111 | 0 | 12 | 0 | 0 | 6,748 | 6,514 | 197 | 611 | 1,325 | 345 | 5,515 | 7,354 | 68.68% | 41.22% |
| BurntSushi_ripgrep | 12,255 | 260 | 9 | 8 | 625 | 38 | 0 | 0 | 0 | 0 | 6,027 | 5,786 | 125 | 0 | 949 | 1,427 | 5,432 | 6,620 | 93.36% | 69.65% |
| crossbeam-rs_crossbeam | 14,929 | 586 | 39 | 185 | 227 | 405 | 0 | 0 | 0 | 0 | 6,449 | 6,155 | 54 | 12 | 310 | 122 | 7,454 | 8,272 | 94.18% | 56.51% |
| serde-rs_serde | 22,417 | 537 | 63 | 75 | 908 | 2,332 | 0 | 0 | 0 | 0 | 10,225 | 8,481 | 637 | 12 | 2,845 | 187 | 10,504 | 10,457 | 75.66% | 27.62% |
| rust-lang_mdBook | 6,570 | 164 | 6 | 3 | 346 | 4 | 0 | 0 | 0 | 0 | 4,595 | 4,572 | 38 | 0 | 495 | 374 | 1,009 | 4,597 | 95.25% | 55.08% |
| fjall-rs_fjall | 7,289 | 1,795 | 0 | 0 | 250 | 25 | 0 | 0 | 0 | 0 | 2,823 | 2,721 | 86 | 0 | 425 | 64 | 2,336 | 3,114 | 82.2% | 45.92% |
| RustCrypto_hashes | 6,412 | 2,419 | 5 | 26 | 121 | 0 | 0 | 0 | 0 | 0 | 2,341 | 2,317 | 20 | 131 | 778 | 225 | 1,349 | 2,716 | 78.06% | 51.42% |
| rust-embedded_cortex-m | 2,171 | 972 | 6 | 51 | 37 | 49 | 0 | 0 | 0 | 0 | 736 | 635 | 0 | 0 | 99 | 42 | 375 | 1,055 | 76.33% | 61.27% |
| **15 used pins** | 385,613 | 39,246 | 836 | 1,142 | 12,409 | 14,566 | 0 | 12 | 0 | 0 | 159,255 | 142,249 | 6,716 | 5,317 | 40,146 | 14,206 | 160,478 | 177,790 | | |
