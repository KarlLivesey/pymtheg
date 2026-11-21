# Go edit stages

CPU seconds on the shared dev server. The last column includes other languages,
validation reads, reports, startup and checkpoint work. Global rebuild is an
after-only measurement included in Go analysis and resolution. The JSON
reports include all stage counters and reverted-store comparisons.

| Pin and edit | Inventory and capture | Prior records and phase input | Parse and file writes | Go analysis | Go resolution | Go validation and link writes | Go global rebuild after | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| restic/restic comment | 1.11 → 1.04 | 2.53 → 1.13 | 0.32 → 0.25 | 4.43 → 1.11 | 2.50 → 1.10 | 1.06 → 0.02 | 2.11 | 15.49 → 5.61 |
| restic/restic body | 1.10 → 1.28 | 2.68 → 1.36 | 0.29 → 0.24 | 4.69 → 1.52 | 2.50 → 1.10 | 1.07 → 0.02 | 2.55 | 17.17 → 6.51 |
| restic/restic export | 1.28 → 1.24 | 2.56 → 2.76 | 0.65 → 0.25 | 4.11 → 5.35 | 2.65 → 2.70 | 1.20 → 1.55 | 2.03 | 17.09 → 17.35 |
| cli/cli comment | 2.23 → 2.47 | 10.17 → 5.52 | 0.28 → 0.29 | 11.59 → 5.38 | 8.15 → 3.65 | 4.09 → 0.04 | 8.88 | 51.95 → 23.50 |
| cli/cli body | 2.22 → 2.30 | 10.86 → 5.54 | 0.42 → 0.41 | 11.75 → 5.13 | 9.04 → 3.74 | 3.20 → 0.03 | 8.72 | 52.23 → 23.07 |
| cli/cli export | 2.56 → 2.14 | 10.22 → 8.72 | 0.35 → 0.28 | 12.03 → 11.23 | 9.88 → 9.30 | 3.74 → 2.41 | 9.22 | 54.21 → 46.14 |
| golang/tools comment | 3.48 → 3.38 | 11.14 → 5.31 | 1.05 → 0.73 | 17.76 → 4.68 | 13.19 → 3.35 | 3.72 → 0.14 | 7.73 | 66.49 → 23.39 |
| golang/tools body | 3.92 → 3.71 | 11.03 → 5.44 | 1.12 → 0.73 | 20.51 → 4.72 | 15.59 → 3.17 | 5.20 → 0.13 | 7.50 | 73.58 → 23.61 |
| golang/tools export | 3.65 → 3.67 | 11.63 → 9.50 | 2.20 → 0.74 | 19.07 → 16.63 | 12.74 → 13.42 | 5.04 → 3.17 | 15.55 | 71.47 → 59.26 |
| labstack/echo comment | 0.34 → 0.29 | 1.55 → 1.11 | 2.28 → 0.95 | 1.87 → 0.46 | 1.38 → 0.35 | 1.14 → 0.11 | 0.68 | 10.27 → 4.38 |
| labstack/echo body | 0.32 → 0.32 | 1.63 → 0.84 | 2.45 → 0.94 | 1.93 → 0.42 | 1.16 → 0.31 | 0.95 → 0.08 | 0.62 | 10.08 → 3.45 |
| labstack/echo export | 0.26 → 0.35 | 1.35 → 1.60 | 2.60 → 0.69 | 2.13 → 2.01 | 1.17 → 1.28 | 0.98 → 0.82 | 0.61 | 10.34 → 8.41 |
