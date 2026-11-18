# Cold index observations after review

Each trial used a fresh graph on the same dev-server source copy. Main ran
on either side of the fixed build. Times are elapsed seconds and peak RSS
is in MiB.

| Repository | Main 1 s / MiB | Fixed s / MiB | Main 2 s / MiB |
| --- | ---: | ---: | ---: |
| pmndrs/zustand | 11.51 / 383.4 | 12.01 / 395.0 | 15.80 / 385.6 |
| yargs/yargs | 19.29 / 393.5 | 22.48 / 396.5 | 22.25 / 397.5 |

Zustand's fixed time falls within the two main trials. Its peak RSS was
about 10.5 MiB above their mean. The fixed yargs index was 0.23 seconds
slower than the slower main trial and its peak RSS fell within their range.

[Benchmark script](../cold.mjs)
