# C-43 per-pin figures

Cold indexes of each pin, source-only and with the Rust toolchain route (rust-analyzer 1.98.1, offline, the measurement's own crate cache filled by `cargo fetch` and online `cargo metadata` on throwaway copies). Level 2 counts Rust links only (resolved, or a library target with a symbol); D20 library module links are given apart. Times and memory are observations.

## Level 2 and the route's state

| Pin | State | Rust links | Source-only Level 2 | of which assumption-marked | With the route | Toolchain-decided | Confirmed | Kept where different | Library module links (D20) | RA wall s | RA CPU s | RA peak MiB | Index wall s, source-only / route |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| embassy-rs_embassy | unavailable (no Cargo.toml at the project root) | 515,233 | 174,016 (33.77%) | 268 | 174,016 (33.77%) | 0 | 0 | 0 | 0 | — | — | — | 1788.5 / 1740.3 |
| DioxusLabs_dioxus | partial (build script of atk-sys did not finish) | 150,404 | 73,311 (48.74%) | 3,668 | 73,311 (48.74%) | 0 | 0 | 0 | 0 | 307.4 | 984.4 | 9719 | 419.3 / 1234.4 |
| helix-editor_helix | used | 90,583 | 40,673 (44.9%) | 2,491 | 52,175 (57.6%) | 11,502 | 14,425 | 5 | 0 | 110.6 | 1065.7 | 2457 | 67.8 / 289.2 |
| tauri-apps_tauri | partial (build script of atk-sys did not finish) | 88,113 | 42,580 (48.32%) | 3,401 | 42,580 (48.32%) | 0 | 0 | 0 | 0 | 121.2 | 565.6 | 5203 | 86.1 / 539.5 |
| actix_actix-web | used | 86,640 | 36,227 (41.81%) | 3,111 | 50,801 (58.63%) | 14,574 | 10,737 | 5 | 0 | 92.9 | 276.8 | 3030 | 72.3 / 238.5 |
| cberner_redb | used | 73,731 | 35,223 (47.77%) | 110 | 46,353 (62.87%) | 11,130 | 11,648 | 28 | 0 | 126.3 | 1906 | 2058 | 51.4 / 230.1 |
| rustls_rustls | used | 70,802 | 23,060 (32.57%) | 299 | 41,284 (58.31%) | 18,224 | 6,864 | 0 | 0 | 94.9 | 457 | 2372 | 103.1 / 258.4 |
| clap-rs_clap | used | 60,489 | 20,474 (33.85%) | 41 | 39,025 (64.52%) | 18,551 | 5,008 | 5 | 0 | 42.4 | 76.7 | 1671 | 42.7 / 120.1 |
| ratatui_ratatui | used | 60,424 | 25,892 (42.85%) | 1,793 | 39,913 (66.05%) | 14,021 | 10,666 | 1 | 0 | 66.6 | 269.1 | 2852 | 58.6 / 192.3 |
| tree-sitter_tree-sitter | used | 54,645 | 25,212 (46.14%) | 2,914 | 31,269 (57.22%) | 6,057 | 8,959 | 0 | 0 | 43.7 | 114.1 | 1656 | 41.4 / 122.6 |
| tokio-rs_axum | used | 41,067 | 16,583 (40.38%) | 1,144 | 20,701 (50.41%) | 4,118 | 3,058 | 0 | 0 | 30.9 | 75.9 | 1956 | 32.9 / 108.2 |
| BurntSushi_ripgrep | used | 39,819 | 26,307 (66.07%) | 1 | 30,556 (76.74%) | 4,249 | 9,947 | 2 | 0 | 20.5 | 42.3 | 1202 | 24.7 / 61 |
| crossbeam-rs_crossbeam | used | 34,081 | 19,138 (56.15%) | 0 | 26,204 (76.89%) | 7,066 | 3,694 | 0 | 0 | 37.4 | 49.6 | 1254 | 24.2 / 81.3 |
| alacritty_alacritty | partial (build script of crossfont did not finish) | 31,393 | 15,477 (49.3%) | 252 | 15,477 (49.3%) | 0 | 0 | 0 | 0 | 35.4 | 89.3 | 1687 | 25 / 96.9 |
| serde-rs_serde | used | 30,714 | 8,297 (27.01%) | 0 | 15,411 (50.18%) | 7,114 | 593 | 0 | 0 | 22.1 | 41.5 | 1147 | 31.3 / 78.9 |
| rust-lang_mdBook | used | 13,866 | 7,263 (52.38%) | 404 | 8,186 (59.04%) | 923 | 2,038 | 0 | 0 | 23 | 96.9 | 1906 | 16.4 / 70 |
| fjall-rs_fjall | used | 13,361 | 6,072 (45.45%) | 97 | 7,979 (59.72%) | 1,907 | 1,451 | 0 | 0 | 14.1 | 26.3 | 1101 | 10.2 / 40.5 |
| RustCrypto_hashes | used | 12,911 | 6,414 (49.68%) | 301 | 6,984 (54.09%) | 570 | 1,643 | 0 | 0 | 32 | 37.3 | 936 | 8.8 / 78.9 |
| rust-embedded_cortex-m | used | 5,531 | 3,347 (60.51%) | 7 | 3,606 (65.2%) | 259 | 724 | 0 | 0 | 12.9 | 31.5 | 925 | 5.5 / 30.3 |
| **19 pins** | 15 used | 1,473,807 | 605,566 (41.09%) | 20,302 | 725,831 (49.25%) | 120,265 | 91,455 | 46 | 0 | | | | |
| **15 used pins** | | 688,664 | 43.59% | | 61.05% | | | | | | | | |

No pin lost a source-only link or changed a source-only Level 2 link (`check` in each pin's JSON).

## Where the links source-only leaves open go (used pins)

Each open link is counted in the first bucket that applies (funnel.mjs). C-19 columns are C-19's own strict join on the same pins (evidence/c-19/joins), at the commit it measured: its checkout gain credited local bindings to their enclosing item, and its library gain is the part this first PR does not apply.

| Pin | Open after source-only | No answer at the name site | Gate: kind/namespace | Gate: known error classes | Gate: trait-method declaration | Gate: cfg other than test | Gate: cfg-variant guard | Gate: module twin, or module conditions unseen (review) | Gate: conditional candidates (review) | Gate: library/outside set kept | No identity: library item | of which pass the cfg gate | No identity: generated item | No identity: no graph symbol (fields…) | No identity: local binding | Credited | C-19 checkout gain | C-19 library gain | C-19 gated | Route now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| helix-editor_helix | 49,651 | 4,357 | 51 | 40 | 1,558 | 0 | 0 | 0 | 0 | 0 | 23,187 | 22,556 | 505 | 473 | 7,954 | 11,502 | 19,518 | 25,034 | 90.96% | 57.6% |
| actix_actix-web | 49,944 | 4,507 | 272 | 61 | 1,358 | 0 | 0 | 0 | 0 | 0 | 22,834 | 20,387 | 1,040 | 1,241 | 3,942 | 14,574 | 19,439 | 24,639 | 84.82% | 58.63% |
| cberner_redb | 38,394 | 2,872 | 54 | 106 | 1,223 | 0 | 0 | 0 | 0 | 0 | 19,167 | 15,384 | 364 | 10 | 3,416 | 11,130 | 15,259 | 23,621 | 84.59% | 62.87% |
| rustls_rustls | 47,713 | 633 | 176 | 47 | 1,549 | 0 | 0 | 0 | 0 | 0 | 18,482 | 13,605 | 1,263 | 2,173 | 5,166 | 18,224 | 24,234 | 21,421 | 74.17% | 58.31% |
| clap-rs_clap | 39,979 | 4,978 | 21 | 454 | 1,234 | 0 | 0 | 0 | 0 | 0 | 12,185 | 10,654 | 363 | 0 | 2,165 | 18,551 | 16,761 | 10,837 | 83.1% | 64.52% |
| ratatui_ratatui | 34,256 | 2,963 | 69 | 25 | 1,400 | 0 | 0 | 0 | 0 | 0 | 9,794 | 9,496 | 1,279 | 601 | 4,104 | 14,021 | 18,261 | 12,691 | 87.96% | 66.05% |
| tree-sitter_tree-sitter | 29,425 | 1,568 | 31 | 17 | 1,114 | 0 | 0 | 0 | 0 | 0 | 13,662 | 12,986 | 745 | 53 | 6,173 | 6,057 | 13,032 | 15,362 | 90.3% | 57.22% |
| tokio-rs_axum | 24,208 | 10,635 | 34 | 44 | 459 | 0 | 0 | 12 | 0 | 0 | 6,748 | 6,514 | 197 | 611 | 1,325 | 4,118 | 5,515 | 7,354 | 68.68% | 50.41% |
| BurntSushi_ripgrep | 12,255 | 260 | 9 | 8 | 625 | 0 | 0 | 0 | 0 | 0 | 6,027 | 5,786 | 125 | 0 | 949 | 4,249 | 5,432 | 6,620 | 93.36% | 76.74% |
| crossbeam-rs_crossbeam | 14,929 | 586 | 39 | 185 | 227 | 0 | 0 | 0 | 0 | 0 | 6,449 | 6,155 | 54 | 12 | 310 | 7,066 | 7,454 | 8,272 | 94.18% | 76.89% |
| serde-rs_serde | 22,417 | 537 | 63 | 75 | 908 | 0 | 0 | 0 | 0 | 0 | 10,225 | 8,481 | 637 | 12 | 2,845 | 7,114 | 10,504 | 10,457 | 75.66% | 50.18% |
| rust-lang_mdBook | 6,570 | 164 | 6 | 3 | 346 | 0 | 0 | 0 | 0 | 0 | 4,595 | 4,572 | 38 | 0 | 495 | 923 | 1,009 | 4,597 | 95.25% | 59.04% |
| fjall-rs_fjall | 7,289 | 1,795 | 0 | 0 | 250 | 0 | 0 | 0 | 0 | 0 | 2,823 | 2,721 | 86 | 0 | 425 | 1,907 | 2,336 | 3,114 | 82.2% | 59.72% |
| RustCrypto_hashes | 6,412 | 2,419 | 5 | 26 | 121 | 0 | 0 | 0 | 0 | 0 | 2,341 | 2,317 | 20 | 131 | 778 | 570 | 1,349 | 2,716 | 78.06% | 54.09% |
| rust-embedded_cortex-m | 2,171 | 972 | 6 | 51 | 37 | 0 | 0 | 0 | 0 | 0 | 736 | 635 | 0 | 0 | 99 | 259 | 375 | 1,055 | 76.33% | 65.2% |
| **15 used pins** | 385,613 | 39,246 | 836 | 1,142 | 12,409 | 0 | 0 | 12 | 0 | 0 | 159,255 | 142,249 | 6,716 | 5,317 | 40,146 | 120,265 | 160,478 | 177,790 | | |
