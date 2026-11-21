# C-24 cold index cost (review round 1 build)

Measured on a shared dev server under load. These are observations, not
claims beyond the numbers.

## Controlled sequential runs

From [cost-runs.sh](cost-runs.sh), run twice: main, branch, main, each a
cold index of the same checkout copy under its own project id. CPU is user
plus system seconds; RSS is peak KiB. `main3` is current main, `c24g` this branch.

```
alacritty main3 cpu=78.37 wall=1:38.08 rss_kib=784392
alacritty c24g cpu=96.44 wall=3:18.64 rss_kib=749844
alacritty main3 cpu=79.21 wall=1:19.72 rss_kib=785448
rustls main3 cpu=287.68 wall=5:06.65 rss_kib=1484144
rustls c24g cpu=287.18 wall=5:51.29 rss_kib=1371864
rustls main3 cpu=274.68 wall=5:06.14 rss_kib=1438632
alacritty main3 cpu=56.87 wall=0:53.58 rss_kib=877672
alacritty c24g cpu=55.68 wall=0:53.49 rss_kib=781412
alacritty main3 cpu=54.06 wall=0:47.26 rss_kib=831072
rustls main3 cpu=189.31 wall=2:54.51 rss_kib=1446188
rustls c24g cpu=188.35 wall=3:04.52 rss_kib=1482664
rustls main3 cpu=199.45 wall=2:57.60 rss_kib=1481048
```

## Two main runs and the branch side by side (one session, same storage)

From [cost.mjs](cost.mjs) on the sweep results (19 pins):

| Pin | Main CPU s (2 runs) | C-24 CPU s | vs main mean | Main peak RSS MiB | C-24 peak RSS MiB | vs main mean |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| BurntSushi/ripgrep | 116.2 / 118.6 | 109.9 | -6.3% | 767 / 771 | 762 | -0.9% |
| DioxusLabs/dioxus | 964.5 / 721.3 | 709.0 | -15.9% | 2587 / 2745 | 2460 | -7.7% |
| RustCrypto/hashes | 29.6 / 29.1 | 37.8 | 28.9% | 493 / 485 | 481 | -1.6% |
| actix/actix-web | 238.7 / 304.1 | 160.7 | -40.8% | 1326 / 1315 | 1255 | -4.9% |
| alacritty/alacritty | 80.6 / 71.6 | 110.8 | 45.7% | 768 / 772 | 758 | -1.5% |
| cberner/redb | 227.0 / 189.3 | 194.9 | -6.3% | 1046 / 1054 | 1054 | 0.4% |
| clap-rs/clap | 186.7 / 167.8 | 124.3 | -29.9% | 883 / 922 | 877 | -2.8% |
| crossbeam-rs/crossbeam | 99.8 / 78.3 | 107.3 | 20.5% | 758 / 758 | 762 | 0.5% |
| embassy-rs/embassy | 3329.4 / 3346.5 | 1807.4 | -45.9% | 4388 / 4404 | 4723 | 7.4% |
| fjall-rs/fjall | 32.1 / 30.9 | 44.2 | 40.3% | 555 / 550 | 573 | 3.8% |
| helix-editor/helix | 241.4 / 285.9 | 159.1 | -39.7% | 1263 / 1298 | 1245 | -2.7% |
| ratatui/ratatui | 162.5 / 216.8 | 166.0 | -12.5% | 1069 / 1044 | 1050 | -0.6% |
| rust-embedded/cortex-m | 20.1 / 15.3 | 22.0 | 24.0% | 358 / 354 | 374 | 5.0% |
| rust-lang/mdBook | 44.8 / 41.2 | 63.1 | 46.6% | 665 / 650 | 614 | -6.6% |
| rustls/rustls | 287.7 / 302.8 | 217.2 | -26.5% | 1448 / 1485 | 1451 | -1.1% |
| serde-rs/serde | 101.3 / 97.5 | 111.4 | 12.1% | 867 / 859 | 836 | -3.1% |
| tauri-apps/tauri | 244.1 / 323.5 | 212.6 | -25.1% | 1531 / 1290 | 1334 | -5.4% |
| tokio-rs/axum | 135.4 / 98.3 | 136.5 | 16.8% | 908 / 908 | 900 | -0.8% |
| tree-sitter/tree-sitter | 167.9 / 156.4 | 174.2 | 7.4% | 986 / 978 | 1010 | 2.9% |
| **All pins** | **6653 (mean)** | **4668** | **-29.8%** | **22652 (sum of means)** | **22520** | **-0.6%** |

## Canonical order

From [order-cost.mjs](order-cost.mjs), five repeats on finished stores:

```
dioxus      {"files":884,"symbols":16657,"links":149377,"milliseconds":[285,357,263,289,289]}
tree-sitter {"files":113,"symbols":3981,"links":54637,"milliseconds":[87,78,78,79,79]}
```
