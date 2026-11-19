# Cold indexing and default heap

## Review cold bracket on tmpfs

Main at `595ec7b` ran before and after the module 26 candidate on the same
source copy for each pin. Each trial used a fresh store. Wall time is in
seconds and peak RSS is in KiB. The suite and the corpus replay shared the
server during part of this bracket.

| Repository | Main 1 seconds / KiB | C-11 seconds / KiB | Main 2 seconds / KiB |
| --- | ---: | ---: | ---: |
| Vitest | 136.28 / 2,556,928 | 122.22 / 2,592,940 | 114.03 / 2,811,824 |
| Astro | 129.43 / 1,759,452 | 134.73 / 1,840,488 | 119.69 / 1,769,384 |
| Hono | 45.08 / 1,710,976 | 49.56 / 1,641,188 | 45.34 / 1,699,360 |

Relative to its main mean, C-11 took 2.3% less wall time on Vitest,
8.2% more on Astro and 9.6% more on Hono.

## Initial disk-backed bracket

Each bracket uses one dev-server source copy and three fresh graph stores.
Main ran first and last around C-11. Times are wall seconds and peak
resident memory is in KiB. The shared server load varied during the runs.
[Runner](bench.mjs)

| Repository | Main 1 seconds / KiB | C-11 seconds / KiB | Main 2 seconds / KiB |
| --- | ---: | ---: | ---: |
| Vitest | 1,269.71 / 2,088,532 | 574.44 / 1,792,116 | 1,430.00 / 2,117,544 |
| Astro | 1,486.05 / 1,589,268 | 881.71 / 1,651,992 | 5,721.01 / 1,822,012 |
| Hono | 158.71 / 1,263,960 | 170.13 / 1,185,416 | 219.64 / 1,236,520 |

The Vitest bracket used the first C-11 sweep executable. Both main trials
and the C-11 trial indexed 2,490 files, 17,973 symbols, and 116,220 links.
C-11 recorded 17,574 definite library links and increased the number of
candidate sets from 128 to 144. All three trials reported the same three
failed files.

Astro used the executable with the unreadable workspace guard. All three
trials indexed the same 3,362 files, 26,243 symbols and 152,561 sites and
reported the same four failed files and 118 partial analyses. C-11 stored
64,048 definite library targets. Its peak RSS fell between the two main
observations. The main wall observations differed by a factor of 3.85
under shared-server load.

Hono used the C-11 executable with both package-boundary fixes. Its C-11
wall time fell within the two main observations. The measured peak RSS
was lower than both main runs.

The workspace-context audit found no source affected by the later
package-boundary fixes in these three pinned repositories.

## T3 Code on the default heap

The C-2 own-code pin `b387e3a179d7495321019363c5ba11e847834cd0` completed
on Node 24.21.0 with its default heap and `.repos` excluded. It took
6,326.49 wall seconds and used 4,354,000 KiB peak RSS. The index contains
7,214 files, 181,778 symbols, and 1,164,220 links, including 417,721
definite library links. The CLI returned exit 2 for 1,488 partial analyses
and reported zero failed files. [Runner](own-code.mjs)

The module 27 rerun on tmpfs took 660.76 seconds and reached 4,519,040 KiB
peak RSS with the default heap. Its 7,214 files produced 181,778 symbols
and 1,164,293 links, including 418,102 definite library links. The CLI
reported 1,488 partial analyses and zero failed files.

The module 28 second-review build completed the same default-heap check
in 738.89 seconds with 4,574,312 KiB peak RSS. It indexed 7,214 files,
181,778 symbols and 1,164,293 links, with 407,320 definite library links,
1,488 partial analyses and zero failed files.
