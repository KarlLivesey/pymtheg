# C-43 per-pin figures

Cold indexes of each pin, source-only and with the Rust toolchain route (rust-analyzer 1.98.1, offline, the measurement's own crate cache filled by `cargo fetch` and online `cargo metadata` on throwaway copies). Level 2 counts Rust links only (resolved, or a library target with a symbol); D20 library module links are given apart. Times and memory are observations.

## Level 2 and the route's state

| Pin | State | Rust links | Source-only Level 2 | of which assumption-marked | With the route | Toolchain-decided | Confirmed | Kept where different | Library module links (D20) | RA wall s | RA CPU s | RA peak MiB | Index wall s, source-only / route |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| DioxusLabs_dioxus | partial (build script of atk-sys did not finish) | 150,404 | 73,311 (48.74%) | 3,668 | 73,311 (48.74%) | 0 | 0 | 0 | 0 | 374 | 1132.7 | 9718 | 579.3 / 1370.3 |
| helix-editor_helix | used | 90,583 | 40,673 (44.9%) | 2,491 | 51,731 (57.11%) | 11,058 | 13,784 | 0 | 0 | 126.9 | 1132.2 | 2454 | 82 / 384.5 |
| tauri-apps_tauri | partial (build script of atk-sys did not finish) | 88,113 | 42,580 (48.32%) | 3,401 | 42,580 (48.32%) | 0 | 0 | 0 | 0 | 161.5 | 664.1 | 5176 | 117.4 / 675.6 |
| actix_actix-web | used | 86,640 | 36,227 (41.81%) | 3,111 | 46,597 (53.78%) | 10,370 | 9,440 | 0 | 0 | 120.8 | 318.8 | 3026 | 80.2 / 334.9 |
| cberner_redb | used | 73,731 | 35,223 (47.77%) | 110 | 43,934 (59.59%) | 8,711 | 9,848 | 0 | 0 | 147.3 | 1969 | 2054 | 62.9 / 285.6 |
| rustls_rustls | used | 70,802 | 23,060 (32.57%) | 299 | 28,850 (40.75%) | 5,790 | 6,380 | 0 | 0 | 120.7 | 533.8 | 2365 | 129.3 / 312.9 |
| clap-rs_clap | used | 60,489 | 20,474 (33.85%) | 41 | 33,948 (56.12%) | 13,474 | 4,389 | 0 | 0 | 50.7 | 88.6 | 1669 | 58.8 / 143.8 |
| ratatui_ratatui | used | 60,424 | 25,892 (42.85%) | 1,793 | 39,258 (64.97%) | 13,366 | 10,453 | 0 | 0 | 66.8 | 278 | 2844 | 65.4 / 198.5 |
| tree-sitter_tree-sitter | used | 54,645 | 25,212 (46.14%) | 2,914 | 30,720 (56.22%) | 5,508 | 7,507 | 0 | 0 | 57.5 | 133.9 | 1646 | 54.1 / 149.4 |
| tokio-rs_axum | used | 41,067 | 16,583 (40.38%) | 1,144 | 18,746 (45.65%) | 2,163 | 2,413 | 0 | 0 | 44.5 | 98.6 | 1961 | 50.6 / 157.2 |
| BurntSushi_ripgrep | used | 39,819 | 26,307 (66.07%) | 1 | 29,895 (75.08%) | 3,588 | 9,331 | 0 | 0 | 24 | 48 | 1200 | 35.3 / 74.4 |
| crossbeam-rs_crossbeam | used | 34,081 | 19,138 (56.15%) | 0 | 19,442 (57.05%) | 304 | 910 | 0 | 0 | 40.8 | 53.8 | 1255 | 30.2 / 85.1 |
| alacritty_alacritty | partial (build script of crossfont did not finish) | 31,393 | 15,477 (49.3%) | 252 | 15,477 (49.3%) | 0 | 0 | 0 | 0 | 45.2 | 110.5 | 1679 | 35.7 / 145.9 |
| serde-rs_serde | used | 30,714 | 8,297 (27.01%) | 0 | 9,147 (29.78%) | 850 | 584 | 0 | 0 | 31.1 | 53.9 | 1151 | 42.5 / 112.1 |
| rust-lang_mdBook | used | 13,866 | 7,263 (52.38%) | 404 | 8,157 (58.83%) | 894 | 1,950 | 0 | 0 | 24.1 | 101.5 | 1903 | 18.2 / 81.2 |
| fjall-rs_fjall | used | 13,361 | 6,072 (45.45%) | 97 | 7,948 (59.49%) | 1,876 | 1,438 | 0 | 0 | 16 | 28.7 | 1099 | 12.8 / 46.3 |
| RustCrypto_hashes | used | 12,911 | 6,414 (49.68%) | 301 | 6,782 (52.53%) | 368 | 1,556 | 0 | 0 | 41.4 | 46.7 | 933 | 13.2 / 100.8 |
| rust-embedded_cortex-m | used | 5,531 | 3,347 (60.51%) | 7 | 3,511 (63.48%) | 164 | 501 | 0 | 0 | 14.7 | 34.8 | 929 | 7.4 / 38.2 |
| **18 pins** | 15 used | 958,574 | 431,550 (45.02%) | 20,034 | 510,034 (53.21%) | 78,484 | 80,484 | 0 | 0 | | | | |
| **15 used pins** | | 688,664 | 43.59% | | 54.99% | | | | | | | | |

No pin lost a source-only link or changed a source-only Level 2 link (`check` in each pin's JSON).

## Where the links source-only leaves open go (used pins)

Each open link is counted in the first bucket that applies (funnel.mjs). C-19 columns are C-19's own strict join on the same pins (evidence/c-19/joins), at the commit it measured: its checkout gain credited local bindings to their enclosing item, and its library gain is the part this first PR does not apply.

| Pin | Open after source-only | No answer at the name site | Gate: kind/namespace | Gate: known error classes | Gate: trait-method declaration | Gate: cfg other than test | Gate: cfg-variant guard | Gate: cfg on an enclosing module (review) | Gate: conditional candidates (review) | Gate: library/outside set kept | No identity: library item | of which pass the cfg gate | No identity: generated item | No identity: no graph symbol (fields…) | No identity: local binding | Credited | C-19 checkout gain | C-19 library gain | C-19 gated | Route now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| helix-editor_helix | 49,651 | 4,357 | 51 | 40 | 1,558 | 80 | 50 | 22 | 316 | 0 | 23,187 | 22,556 | 505 | 473 | 7,954 | 11,058 | 19,518 | 25,034 | 90.96% | 57.11% |
| actix_actix-web | 49,944 | 4,507 | 272 | 61 | 1,358 | 1,285 | 30 | 422 | 2,582 | 0 | 22,834 | 20,387 | 1,040 | 1,241 | 3,942 | 10,370 | 19,439 | 24,639 | 84.82% | 53.78% |
| cberner_redb | 38,394 | 2,872 | 54 | 106 | 1,223 | 1,627 | 660 | 35 | 149 | 0 | 19,167 | 15,384 | 364 | 10 | 3,416 | 8,711 | 15,259 | 23,621 | 84.59% | 59.59% |
| rustls_rustls | 47,713 | 633 | 176 | 47 | 1,549 | 4,807 | 6,567 | 344 | 716 | 0 | 18,482 | 13,605 | 1,263 | 2,173 | 5,166 | 5,790 | 24,234 | 21,421 | 74.17% | 40.75% |
| clap-rs_clap | 39,979 | 4,978 | 21 | 454 | 1,234 | 3,254 | 404 | 738 | 709 | 0 | 12,185 | 10,654 | 363 | 0 | 2,165 | 13,474 | 16,761 | 10,837 | 83.1% | 56.12% |
| ratatui_ratatui | 34,256 | 2,963 | 69 | 25 | 1,400 | 239 | 9 | 126 | 281 | 0 | 9,794 | 9,496 | 1,279 | 601 | 4,104 | 13,366 | 18,261 | 12,691 | 87.96% | 64.97% |
| tree-sitter_tree-sitter | 29,425 | 1,568 | 31 | 17 | 1,114 | 310 | 69 | 83 | 92 | 0 | 13,662 | 12,986 | 745 | 53 | 6,173 | 5,508 | 13,032 | 15,362 | 90.3% | 56.22% |
| tokio-rs_axum | 24,208 | 10,635 | 34 | 44 | 459 | 111 | 331 | 1,074 | 476 | 0 | 6,748 | 6,514 | 197 | 611 | 1,325 | 2,163 | 5,515 | 7,354 | 68.68% | 45.65% |
| BurntSushi_ripgrep | 12,255 | 260 | 9 | 8 | 625 | 38 | 19 | 51 | 556 | 0 | 6,027 | 5,786 | 125 | 0 | 949 | 3,588 | 5,432 | 6,620 | 93.36% | 75.08% |
| crossbeam-rs_crossbeam | 14,929 | 586 | 39 | 185 | 227 | 405 | 61 | 6,131 | 166 | 0 | 6,449 | 6,155 | 54 | 12 | 310 | 304 | 7,454 | 8,272 | 94.18% | 57.05% |
| serde-rs_serde | 22,417 | 537 | 63 | 75 | 908 | 2,332 | 3,887 | 23 | 23 | 0 | 10,225 | 8,481 | 637 | 12 | 2,845 | 850 | 10,504 | 10,457 | 75.66% | 29.78% |
| rust-lang_mdBook | 6,570 | 164 | 6 | 3 | 346 | 4 | 2 | 11 | 12 | 0 | 4,595 | 4,572 | 38 | 0 | 495 | 894 | 1,009 | 4,597 | 95.25% | 58.83% |
| fjall-rs_fjall | 7,289 | 1,795 | 0 | 0 | 250 | 25 | 7 | 0 | 2 | 0 | 2,823 | 2,721 | 86 | 0 | 425 | 1,876 | 2,336 | 3,114 | 82.2% | 59.49% |
| RustCrypto_hashes | 6,412 | 2,419 | 5 | 26 | 121 | 0 | 1 | 202 | 0 | 0 | 2,341 | 2,317 | 20 | 131 | 778 | 368 | 1,349 | 2,716 | 78.06% | 52.53% |
| rust-embedded_cortex-m | 2,171 | 972 | 6 | 51 | 37 | 49 | 9 | 38 | 10 | 0 | 736 | 635 | 0 | 0 | 99 | 164 | 375 | 1,055 | 76.33% | 63.48% |
| **15 used pins** | 385,613 | 39,246 | 836 | 1,142 | 12,409 | 14,566 | 12,106 | 9,300 | 6,090 | 0 | 159,255 | 142,249 | 6,716 | 5,317 | 40,146 | 78,484 | 160,478 | 177,790 | | |
