# Taste
- Communicates in Chinese and expects replies in Chinese. Confidence: 0.7
- Validates API/extractor behavior with runnable scripts under `scripts/` driven by real credentials (e.g. `bun run scripts/<probe>.ts`), rather than trusting assumptions or only unit tests. Confidence: 0.6
- Wants verification scripts to cover every scenario explicitly called out (list, single item, collection, …) and each one exercised individually. Confidence: 0.6
- Prefers one command-driven script with a subcommand per scenario plus usage/help output, instead of many ad-hoc scripts. Confidence: 0.5
- When a bug or degraded behavior is identified and offered as an open question, expects it fixed right away rather than left as a known issue. Confidence: 0.5
- Prefers failing explicitly (warn + return nothing) over silent fallbacks that return broader/unintended data when a requested identifier can't be matched. Confidence: 0.5
