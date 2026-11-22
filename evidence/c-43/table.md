# C-43 per-pin figures

Cold indexes of each pin, source-only and with the Rust toolchain route (rust-analyzer 1.98.1, offline, the measurement's own crate cache filled by `cargo fetch` and online `cargo metadata` on throwaway copies). Level 2 counts Rust links only (resolved, or a library target with a symbol); D20 library module links are given apart. Times and memory are observations.

## Level 2 and the route's state

| Pin | State | Rust links | Source-only Level 2 | of which assumption-marked | With the route | Toolchain-decided | Confirmed | Kept where different | Library module links (D20) | RA wall s | RA CPU s | RA peak MiB | Index wall s, source-only / route |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| embassy-rs_embassy | unavailable (no Cargo.toml at the project root) | 515,233 | 174,016 (33.77%) | 268 | 174,016 (33.77%) | 0 | 0 | 0 | 0 | — | — | — | 1788.5 / 1740.3 |
| DioxusLabs_dioxus | partial (build script of atk-sys did not finish) | 150,404 | 73,311 (48.74%) | 3,668 | 73,311 (48.74%) | 0 | 0 | 0 | 0 | 362.3 | 1106.3 | 9734 | 542.7 / 906.6 |
| helix-editor_helix | used | 90,583 | 40,673 (44.9%) | 2,491 | 52,069 (57.48%) | 11,396 | 13,924 | 0 | 0 | 112.7 | 1096.2 | 2460 | 93.9 / 223.1 |
| tauri-apps_tauri | partial (build script of atk-sys did not finish) | 88,113 | 42,580 (48.32%) | 3,401 | 42,580 (48.32%) | 0 | 0 | 0 | 0 | 103.9 | 517.4 | 5200 | 107.8 / 228.7 |
| actix_actix-web | used | 86,640 | 36,227 (41.81%) | 3,111 | 49,643 (57.3%) | 13,416 | 10,069 | 0 | 0 | 92.3 | 274 | 3029 | 112.1 / 195.7 |
| cberner_redb | used | 73,731 | 35,223 (47.77%) | 110 | 44,116 (59.83%) | 8,893 | 9,882 | 0 | 0 | 115.9 | 1900.1 | 2064 | 66.1 / 189 |
| rustls_rustls | used | 70,802 | 23,060 (32.57%) | 299 | 29,910 (42.24%) | 6,850 | 6,554 | 0 | 0 | 117.5 | 511.9 | 2356 | 143.5 / 279.1 |
| clap-rs_clap | used | 60,489 | 20,474 (33.85%) | 41 | 35,395 (58.51%) | 14,921 | 4,530 | 0 | 0 | 43.6 | 78 | 1671 | 53.6 / 114.7 |
| ratatui_ratatui | used | 60,424 | 25,892 (42.85%) | 1,793 | 39,665 (65.64%) | 13,773 | 10,488 | 0 | 0 | 70.4 | 284.8 | 2835 | 66.2 / 146.4 |
| tree-sitter_tree-sitter | used | 54,645 | 25,212 (46.14%) | 2,914 | 30,895 (56.54%) | 5,683 | 8,252 | 0 | 0 | 53.2 | 137.2 | 1652 | 65.6 / 119.8 |
| tokio-rs_axum | used | 41,067 | 16,583 (40.38%) | 1,144 | 20,284 (49.39%) | 3,701 | 2,756 | 0 | 0 | 32.4 | 79.9 | 1960 | 46.7 / 78.7 |
| BurntSushi_ripgrep | used | 39,819 | 26,307 (66.07%) | 1 | 30,502 (76.6%) | 4,195 | 9,724 | 0 | 0 | 19.8 | 41.7 | 1214 | 30.6 / 55.6 |
| crossbeam-rs_crossbeam | used | 34,081 | 19,138 (56.15%) | 0 | 25,739 (75.52%) | 6,602 | 3,550 | 0 | 0 | 38.4 | 51.3 | 1253 | 32.6 / 74.8 |
| alacritty_alacritty | partial (build script of crossfont did not finish) | 31,393 | 15,477 (49.3%) | 252 | 15,477 (49.3%) | 0 | 0 | 0 | 0 | 35.8 | 90.8 | 1692 | 32.9 / 72.4 |
| serde-rs_serde | used | 30,714 | 8,297 (27.01%) | 0 | 9,193 (29.93%) | 896 | 585 | 0 | 0 | 26 | 47.2 | 1150 | 39.4 / 64.7 |
| rust-lang_mdBook | used | 13,866 | 7,263 (52.38%) | 404 | 8,180 (58.99%) | 917 | 2,030 | 0 | 0 | 30.7 | 118.1 | 1899 | 19.3 / 59.1 |
| fjall-rs_fjall | used | 13,361 | 6,072 (45.45%) | 97 | 7,950 (59.5%) | 1,878 | 1,438 | 0 | 0 | 15.8 | 28.8 | 1101 | 13.1 / 34.5 |
| RustCrypto_hashes | used | 12,911 | 6,414 (49.68%) | 301 | 6,984 (54.09%) | 570 | 1,615 | 0 | 0 | 41 | 46.5 | 938 | 14.3 / 58 |
| rust-embedded_cortex-m | used | 5,531 | 3,347 (60.51%) | 7 | 3,559 (64.35%) | 212 | 560 | 0 | 0 | 17.8 | 37.9 | 928 | 10.8 / 34.2 |
| **19 pins** | 15 used | 1,473,807 | 605,566 (41.09%) | 20,302 | 699,468 (47.46%) | 93,903 | 85,957 | 0 | 0 | | | | |
| **15 used pins** | | 688,664 | 43.59% | | 57.22% | | | | | | | | |

No pin lost a source-only link or changed a source-only Level 2 link (`check` in each pin's JSON).

## Where the links source-only leaves open go (used pins)

Each open link is counted in the first bucket that applies (funnel.mjs). C-19 columns are C-19's own strict join on the same pins (evidence/c-19/joins), at the commit it measured: its checkout gain credited local bindings to their enclosing item, and its library gain is the part this first PR does not apply.

| Pin | Open after source-only | No answer at the name site | Gate: kind/namespace | Gate: known error classes | Gate: trait-method declaration | Gate: cfg other than test | Gate: cfg-variant guard | Gate: library/outside set kept | No identity: library item | of which pass the cfg gate | No identity: generated item | No identity: no graph symbol (fields…) | No identity: local binding | Credited | C-19 checkout gain | C-19 library gain | C-19 gated | Route now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| helix-editor_helix | 49,651 | 4,357 | 51 | 40 | 1,558 | 80 | 50 | 0 | 23,187 | 22,556 | 505 | 473 | 7,954 | 11,396 | 19,518 | 25,034 | 90.96% | 57.48% |
| actix_actix-web | 49,944 | 4,507 | 272 | 61 | 1,358 | 1,295 | 30 | 0 | 22,834 | 20,387 | 1,040 | 1,189 | 3,942 | 13,416 | 19,439 | 24,639 | 84.82% | 57.3% |
| cberner_redb | 38,394 | 2,872 | 54 | 106 | 1,223 | 1,627 | 660 | 0 | 19,167 | 15,384 | 364 | 10 | 3,416 | 8,893 | 15,259 | 23,621 | 84.59% | 59.83% |
| rustls_rustls | 47,713 | 633 | 176 | 47 | 1,549 | 4,807 | 6,567 | 0 | 18,482 | 13,605 | 1,263 | 2,173 | 5,166 | 6,850 | 24,234 | 21,421 | 74.17% | 42.24% |
| clap-rs_clap | 39,979 | 4,978 | 21 | 454 | 1,234 | 3,254 | 404 | 0 | 12,185 | 10,654 | 363 | 0 | 2,165 | 14,921 | 16,761 | 10,837 | 83.1% | 58.51% |
| ratatui_ratatui | 34,256 | 2,963 | 69 | 25 | 1,400 | 239 | 9 | 0 | 9,794 | 9,496 | 1,279 | 601 | 4,104 | 13,773 | 18,261 | 12,691 | 87.96% | 65.64% |
| tree-sitter_tree-sitter | 29,425 | 1,568 | 31 | 17 | 1,114 | 310 | 69 | 0 | 13,662 | 12,986 | 745 | 53 | 6,173 | 5,683 | 13,032 | 15,362 | 90.3% | 56.54% |
| tokio-rs_axum | 24,208 | 10,635 | 34 | 44 | 459 | 111 | 331 | 0 | 6,748 | 6,514 | 197 | 611 | 1,325 | 3,701 | 5,515 | 7,354 | 68.68% | 49.39% |
| BurntSushi_ripgrep | 12,255 | 260 | 9 | 8 | 625 | 38 | 19 | 0 | 6,027 | 5,786 | 125 | 0 | 949 | 4,195 | 5,432 | 6,620 | 93.36% | 76.6% |
| crossbeam-rs_crossbeam | 14,929 | 586 | 39 | 185 | 227 | 405 | 61 | 0 | 6,449 | 6,155 | 54 | 12 | 310 | 6,601 | 7,454 | 8,272 | 94.18% | 75.52% |
| serde-rs_serde | 22,417 | 537 | 63 | 75 | 908 | 2,332 | 3,887 | 0 | 10,225 | 8,481 | 637 | 12 | 2,845 | 896 | 10,504 | 10,457 | 75.66% | 29.93% |
| rust-lang_mdBook | 6,570 | 164 | 6 | 3 | 346 | 4 | 2 | 0 | 4,595 | 4,572 | 38 | 0 | 495 | 917 | 1,009 | 4,597 | 95.25% | 58.99% |
| fjall-rs_fjall | 7,289 | 1,795 | 0 | 0 | 250 | 25 | 7 | 0 | 2,823 | 2,721 | 86 | 0 | 425 | 1,878 | 2,336 | 3,114 | 82.2% | 59.5% |
| RustCrypto_hashes | 6,412 | 2,419 | 5 | 26 | 121 | 0 | 1 | 0 | 2,341 | 2,317 | 20 | 131 | 778 | 570 | 1,349 | 2,716 | 78.06% | 54.09% |
| rust-embedded_cortex-m | 2,171 | 972 | 6 | 51 | 37 | 49 | 9 | 0 | 736 | 635 | 0 | 0 | 99 | 212 | 375 | 1,055 | 76.33% | 64.35% |
| **15 used pins** | 385,613 | 39,246 | 836 | 1,142 | 12,409 | 14,576 | 12,106 | 0 | 159,255 | 142,249 | 6,716 | 5,265 | 40,146 | 93,902 | 160,478 | 177,790 | | |
