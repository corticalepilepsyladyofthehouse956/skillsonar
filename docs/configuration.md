# Configuration

Configuration is optional. Every default is chosen to be useful with no config file at all.

## Discovery

`skillsonar` searches upward from the working directory for `skillsonar.config.json`, stopping at the filesystem root. Running from a subdirectory of a monorepo therefore picks up the repository's config, the same way test runners and formatters behave.

Override with `--config path/to/file.json`.

Generate a starter file:

```bash
skillsonar init
```

## Full reference

```json
{
  "rules": {
    "SR009": "off",
    "SR011": "error"
  },

  "scoring": {
    "k1": 1.2,
    "nameWeight": 2.5,
    "descriptionWeight": 1.0,
    "nameLengthNormalisation": 0.35,
    "descriptionLengthNormalisation": 0.75
  },

  "thresholds": {
    "ambiguousMargin": 0.1,
    "contestedMargin": 0.3,
    "minimumCoverage": 0.15
  },

  "collisions": {
    "critical": 0.75,
    "high": 0.55,
    "moderate": 0.4
  },

  "budget": {
    "contextWindow": 200000,
    "maxSkillResidentTokens": 260,
    "maxBodyTokens": 6000
  },

  "exclude": ["fixtures", "archive"],
  "followSymlinks": false,
  "maxDepth": 8
}
```

### `rules`

Keyed by rule **id** (`SR011`), not title. Values: `"error"`, `"warning"`, `"info"`, `"off"`.

Using a title instead of an id is rejected with the correct id in the message. See [`rules.md`](rules.md).

### `scoring`

BM25F parameters. Explained in [`scoring.md`](scoring.md#4-bm25f).

| Option | Default | Range | Effect |
|---|---|---|---|
| `k1` | 1.2 | 0.1–10 | Term-frequency saturation. Higher keeps rewarding repetition longer. |
| `nameWeight` | 2.5 | 0–20 | How much a term in the skill name outweighs one in the description. |
| `descriptionWeight` | 1.0 | 0–20 | Baseline weight. |
| `nameLengthNormalisation` | 0.35 | 0–1 | Penalty for longer names. |
| `descriptionLengthNormalisation` | 0.75 | 0–1 | Penalty for longer descriptions. Lower this if your house style is deliberately thorough descriptions. |

### `thresholds`

Routing verdicts.

| Option | Default | Effect |
|---|---|---|
| `ambiguousMargin` | 0.1 | Below this relative gap the top two are effectively tied. |
| `contestedMargin` | 0.3 | Below this the decision is fragile but leaning. |
| `minimumCoverage` | 0.15 | Share of a query's available weight the winner must capture to count as a match at all. |

`ambiguousMargin` must not exceed `contestedMargin`; the mistake is rejected at load time with an explanation.

> **Removed:** `minimumScore` was an absolute BM25 score and is no longer accepted. Absolute score floors are not comparable across collection sizes — see [`scoring.md`](scoring.md#5-margin-and-coverage) for the bug this caused. Use `minimumCoverage`.

### `collisions`

Contested-mass thresholds, all in `[0, 1]`. Must satisfy `critical ≥ high ≥ moderate`.

Raise these if your collection is intentionally dense — a set of ten PDF skills will legitimately share vocabulary. Lower them for a broad, general-purpose collection where overlap is always a mistake.

### `budget`

| Option | Default | Effect |
|---|---|---|
| `contextWindow` | 200000 | Window the resident share is reported against. |
| `maxSkillResidentTokens` | 260 | Above this a single skill triggers SR014. |
| `maxBodyTokens` | 6000 | Above this a body triggers SR016. |

Token counts are estimates within roughly 10–15% of a real tokenizer.

### Discovery options

| Option | Default | Effect |
|---|---|---|
| `exclude` | `[]` | Extra directory names to skip, on top of `node_modules`, `.git`, `dist`, and similar. |
| `followSymlinks` | `false` | Off by default: a symlink inside an untrusted skill pack can point outside the scan root, turning a scan into an unbounded filesystem traversal. |
| `maxDepth` | 8 | Directory depth below each root. |

## Command-line overrides

Flags take precedence over the file — the config is the project's standing decision, the flag is this invocation's exception.

```bash
skillsonar scan --context-window 1000000
skillsonar scan --collision-severity critical    # only the worst pairs
skillsonar scan --min-severity warning           # exit 1 on warnings too
skillsonar scan --follow-symlinks
```

## Validation

Malformed configuration is rejected at load time, naming the file, the option and the valid range:

```
skillsonar: /repo/skillsonar.config.json
  scoring.descriptionLengthNormalisation must be between 0 and 1, got 40
```

This matters more than usual here. An out-of-range scoring parameter does not throw — it silently produces a plausible-looking but meaningless analysis. Failing at load time is the only way anyone finds out.
