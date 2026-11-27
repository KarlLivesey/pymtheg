# C-43 per-pin figures

Cold indexes of each pin, source-only and with the Rust toolchain route (rust-analyzer 1.98.1, offline, the measurement's own crate cache filled by `cargo fetch` and online `cargo metadata` on throwaway copies). Level 2 counts Rust links only (resolved, or a library target with a symbol); D20 library module links are given apart. Times and memory are observations.

## Level 2 and the route's state

| Pin | State | Rust links | Source-only Level 2 | of which assumption-marked | With the route | Toolchain checkout | Toolchain library (D24) | Confirmed | Kept where different | Library module links (D20) | RA wall s | RA CPU s | RA peak MiB | Index wall s, source-only / route |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| embassy-rs_embassy | unavailable (no Cargo.toml at the project root) | 515,233 | 174,016 (33.77%) | 268 | 174,016 (33.77%) | 0 | 0 | 0 | 0 | 0 | — | — | — | 1788.5 / 1740.3 |
| DioxusLabs_dioxus | partial (build script of atk-sys did not finish) | 150,404 | 73,311 (48.74%) | 3,668 | 73,311 (48.74%) | 0 | 0 | 0 | 0 | 0 | 383.4 | 1074 | 9717 | 495.5 / 1327.6 |
| helix-editor_helix | used | 90,583 | 40,673 (44.9%) | 2,491 | 74,650 (82.41%) | 11,502 | 22,475 | 14,425 | 5 | 0 | 125.2 | 1088.6 | 2452 | 87.5 / 357.9 |
| tauri-apps_tauri | partial (build script of atk-sys did not finish) | 88,113 | 42,580 (48.32%) | 3,401 | 42,580 (48.32%) | 0 | 0 | 0 | 0 | 0 | 161.4 | 673.5 | 5181 | 95.6 / 663.4 |
| actix_actix-web | used | 86,640 | 36,227 (41.81%) | 3,111 | 73,218 (84.51%) | 14,574 | 22,417 | 10,737 | 5 | 0 | 112.6 | 295 | 3025 | 71.5 / 302.5 |
| cberner_redb | used | 73,731 | 35,223 (47.77%) | 110 | 65,157 (88.37%) | 11,130 | 18,804 | 11,648 | 28 | 0 | 161.5 | 2049.7 | 2056 | 63.2 / 303.9 |
| rustls_rustls | used | 70,802 | 23,060 (32.57%) | 299 | 58,902 (83.19%) | 18,224 | 17,618 | 6,864 | 0 | 0 | 128.3 | 532.6 | 2367 | 126 / 382.6 |
| clap-rs_clap | used | 60,489 | 20,474 (33.85%) | 41 | 50,878 (84.11%) | 18,551 | 11,853 | 5,008 | 5 | 0 | 80.8 | 124.9 | 1670 | 56.2 / 231.1 |
| ratatui_ratatui | used | 60,424 | 25,892 (42.85%) | 1,793 | 49,459 (81.85%) | 14,021 | 9,546 | 10,666 | 1 | 0 | 88.2 | 330.5 | 2836 | 87.4 / 267.2 |
| tree-sitter_tree-sitter | used | 54,645 | 25,212 (46.14%) | 2,914 | 44,498 (81.43%) | 6,057 | 13,229 | 8,959 | 0 | 0 | 64.7 | 157.5 | 1651 | 68.4 / 176.3 |
| tokio-rs_axum | used | 41,067 | 16,583 (40.38%) | 1,144 | 27,364 (66.63%) | 4,118 | 6,663 | 3,058 | 0 | 0 | 49 | 105.4 | 1945 | 45.7 / 168.7 |
| BurntSushi_ripgrep | used | 39,819 | 26,307 (66.07%) | 1 | 36,437 (91.51%) | 4,249 | 5,881 | 9,947 | 2 | 0 | 33.2 | 63.1 | 1202 | 46.2 / 97.3 |
| crossbeam-rs_crossbeam | used | 34,081 | 19,138 (56.15%) | 0 | 32,633 (95.75%) | 7,066 | 6,429 | 3,694 | 0 | 0 | 47.7 | 61.4 | 1255 | 36.9 / 104.1 |
| alacritty_alacritty | partial (build script of crossfont did not finish) | 31,393 | 15,477 (49.3%) | 252 | 15,477 (49.3%) | 0 | 0 | 0 | 0 | 0 | 40.5 | 101.7 | 1682 | 29.4 / 115.7 |
| serde-rs_serde | used | 30,714 | 8,297 (27.01%) | 0 | 25,544 (83.17%) | 7,114 | 10,133 | 593 | 0 | 0 | 32.9 | 55.2 | 1147 | 40.7 / 118.4 |
| rust-lang_mdBook | used | 13,866 | 7,263 (52.38%) | 404 | 12,626 (91.06%) | 923 | 4,440 | 2,038 | 0 | 0 | 27.1 | 111.1 | 1902 | 20.5 / 88.8 |
| fjall-rs_fjall | used | 13,361 | 6,072 (45.45%) | 97 | 10,731 (80.32%) | 1,907 | 2,752 | 1,451 | 0 | 0 | 17.9 | 31.3 | 1096 | 14.4 / 53.7 |
| RustCrypto_hashes | used | 12,911 | 6,414 (49.68%) | 301 | 9,152 (70.89%) | 570 | 2,168 | 1,643 | 0 | 0 | 42.2 | 47.9 | 933 | 11.8 / 103 |
| rust-embedded_cortex-m | used | 5,531 | 3,347 (60.51%) | 7 | 4,305 (77.83%) | 259 | 699 | 724 | 0 | 0 | 14.9 | 34.6 | 927 | 8 / 40.4 |
| **19 pins** | 15 used | 1,473,807 | 605,566 (41.09%) | 20,302 | 880,938 (59.77%) | 120,265 | 155,107 | 91,455 | 46 | 0 | | | | |
| **15 used pins** | | 688,664 | 43.59% | | 83.58% | | | | | | | | |

No pin lost a source-only link or changed a source-only Level 2 link (`check` in each pin's JSON).

## Where the links source-only leaves open go (used pins)

Each open link is counted in the first bucket that applies (funnel.mjs). C-19 columns are C-19's own strict join on the same pins (evidence/c-19/joins), at the commit it measured: its checkout gain credited local bindings to their enclosing item, and its library gain is the part this first PR does not apply.

| Pin | Open after source-only | No answer at the name site | Gate: kind/namespace | Gate: known error classes | Gate: trait-method declaration | Gate: cfg other than test | Gate: cfg-variant guard | Gate: module twin, or module conditions unseen (review) | Gate: conditional candidates (review) | Gate: library/outside set kept | No identity: library item | of which pass the cfg gate | No identity: generated item | No identity: no graph symbol (fields…) | No identity: local binding | Library: source-only target kept | Library: outside the candidate set | Credited: checkout | Credited: library (D24) | C-19 checkout gain | C-19 library gain | C-19 gated | Route now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| helix-editor_helix | 49,651 | 4,357 | 51 | 40 | 1,558 | 0 | 0 | 0 | 0 | 0 | 712 | 688 | 505 | 473 | 7,954 | 0 | 0 | 11,502 | 22,475 | 19,518 | 25,034 | 90.96% | 82.41% |
| actix_actix-web | 49,944 | 4,507 | 272 | 61 | 1,358 | 0 | 0 | 0 | 0 | 0 | 417 | 390 | 1,040 | 1,241 | 3,942 | 0 | 0 | 14,574 | 22,417 | 19,439 | 24,639 | 84.82% | 84.51% |
| cberner_redb | 38,394 | 2,872 | 54 | 106 | 1,223 | 0 | 0 | 0 | 0 | 0 | 363 | 348 | 364 | 10 | 3,416 | 0 | 0 | 11,130 | 18,804 | 15,259 | 23,621 | 84.59% | 88.37% |
| rustls_rustls | 47,713 | 633 | 176 | 47 | 1,549 | 0 | 0 | 0 | 0 | 0 | 864 | 575 | 1,263 | 2,173 | 5,166 | 0 | 0 | 18,224 | 17,618 | 24,234 | 21,421 | 74.17% | 83.19% |
| clap-rs_clap | 39,979 | 4,978 | 21 | 454 | 1,234 | 0 | 0 | 0 | 0 | 0 | 332 | 307 | 363 | 0 | 2,165 | 0 | 0 | 18,551 | 11,853 | 16,761 | 10,837 | 83.1% | 84.11% |
| ratatui_ratatui | 34,256 | 2,963 | 69 | 25 | 1,400 | 0 | 0 | 0 | 0 | 0 | 248 | 244 | 1,279 | 601 | 4,104 | 0 | 0 | 14,021 | 9,546 | 18,261 | 12,691 | 87.96% | 81.85% |
| tree-sitter_tree-sitter | 29,425 | 1,568 | 31 | 17 | 1,114 | 0 | 0 | 0 | 0 | 0 | 433 | 389 | 745 | 53 | 6,173 | 0 | 0 | 6,057 | 13,229 | 13,032 | 15,362 | 90.3% | 81.43% |
| tokio-rs_axum | 24,208 | 10,635 | 34 | 44 | 459 | 0 | 0 | 12 | 0 | 0 | 85 | 85 | 197 | 611 | 1,325 | 0 | 0 | 4,118 | 6,663 | 5,515 | 7,354 | 68.68% | 66.63% |
| BurntSushi_ripgrep | 12,255 | 260 | 9 | 8 | 625 | 0 | 0 | 0 | 0 | 0 | 146 | 142 | 125 | 0 | 949 | 0 | 0 | 4,249 | 5,881 | 5,432 | 6,620 | 93.36% | 91.51% |
| crossbeam-rs_crossbeam | 14,929 | 586 | 39 | 185 | 227 | 0 | 0 | 0 | 0 | 0 | 20 | 19 | 54 | 12 | 310 | 0 | 0 | 7,066 | 6,429 | 7,454 | 8,272 | 94.18% | 95.75% |
| serde-rs_serde | 22,417 | 537 | 63 | 75 | 908 | 0 | 0 | 0 | 0 | 0 | 92 | 87 | 637 | 12 | 2,845 | 0 | 0 | 7,114 | 10,133 | 10,504 | 10,457 | 75.66% | 83.17% |
| rust-lang_mdBook | 6,570 | 164 | 6 | 3 | 346 | 0 | 0 | 0 | 0 | 0 | 155 | 155 | 38 | 0 | 495 | 0 | 0 | 923 | 4,440 | 1,009 | 4,597 | 95.25% | 91.06% |
| fjall-rs_fjall | 7,289 | 1,795 | 0 | 0 | 250 | 0 | 0 | 0 | 0 | 0 | 71 | 71 | 86 | 0 | 425 | 0 | 0 | 1,907 | 2,752 | 2,336 | 3,114 | 82.2% | 80.32% |
| RustCrypto_hashes | 6,412 | 2,419 | 5 | 26 | 121 | 0 | 0 | 0 | 0 | 0 | 173 | 173 | 20 | 131 | 778 | 0 | 0 | 570 | 2,168 | 1,349 | 2,716 | 78.06% | 70.89% |
| rust-embedded_cortex-m | 2,171 | 972 | 6 | 51 | 37 | 0 | 0 | 0 | 0 | 0 | 37 | 37 | 0 | 0 | 99 | 0 | 0 | 259 | 699 | 375 | 1,055 | 76.33% | 77.83% |
| **15 used pins** | 385,613 | 39,246 | 836 | 1,142 | 12,409 | 0 | 0 | 12 | 0 | 0 | 4,148 | 3,710 | 6,716 | 5,317 | 40,146 | 0 | 0 | 120,265 | 155,107 | 160,478 | 177,790 | | |
