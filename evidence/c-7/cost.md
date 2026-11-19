# Cold index observations

Each repository used the same pinned source copy on dev-server storage, with a
fresh graph and default settings for every trial. One session ran main,
candidate, and main again in that order. Times are elapsed seconds and peak
RSS is in MiB. The shared server was also indexing other checkouts.

| Repository | Main 1 s / MiB | Candidate s / MiB | Main 2 s / MiB |
| --- | ---: | ---: | ---: |
| excalidraw/excalidraw | 423.61 / 1,216.4 | 410.57 / 1,178.4 | 327.69 / 1,159.6 |
| pmndrs/zustand | 13.40 / 380.8 | 16.20 / 387.6 | 13.34 / 379.3 |

Excalidraw's candidate falls within the observed main range for time and RSS.
It stored 4,996 more member symbols and made 1,297 more links definite across
the same 104,519 sites.

Zustand took 2.83 s more than the mean of the two main trials (21%). The
candidate asks the checker for additional receiver and signature information
and stores 146 more member symbols. It gained 430 definite links and two
candidate sets across the same 7,099 sites. Peak RSS increased by about 7.5 MiB.
The benchmark measures the combined index operations.

[Benchmark script](cold.mjs)
