# .planning — internal tooling state

`config.json` holds the graphify tool config. The knowledge-graph artifacts
(`graphs/`) were removed from the repo: the last snapshot was built 33+ commits
ago, still featured the abandoned PayGrade plan as a top community hub, and
didn't know half the current lib files existed — a wrong map is worse than no
map for anyone browsing the repo.

To regenerate against the current code:

```
graphify update .
```
