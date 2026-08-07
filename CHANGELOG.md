# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-08-07

First release.

### Added

**Corpus-level routing analysis** — the findings no single-file linter can produce, because the defect does not live in any one file.

- `SR011 routing-collision` — two skills that respond near-identically to the same queries, measured as directional contested mass and reported against the skill being shadowed.
- `SR012 signature-stolen` — a skill that loses a query built from its own most distinctive terms, and is therefore unreachable by any phrasing of its own purpose.
- `SR013 weak-routing-signal` — a skill whose every term is shared across most of the collection.

**Commands**

- `scan` — full analysis: validation, collisions, context budget.
- `route <query>` — rank every skill against a query, with per-term score attribution, margin and coverage.
- `explain <skill>` — the terms that give a skill its routing power, and the ones that contribute nothing.
- `collide` — colliding pairs only.
- `budget` — resident versus deferred token cost.
- `test` — routing regression tests from `skillsonar.tests.yaml` or `.json`.
- `rules` — every rule with its default severity and rationale.
- `init` — starter config and test suite.

**Fourteen structural rules** covering frontmatter validity, name and description constraints, duplicate names, broken bundled references, unknown keys, and context budget.

**Output formats** — terminal (colour-aware, `NO_COLOR` respected), JSON with a versioned schema, SARIF 2.1.0 with stable fingerprints for GitHub code scanning, and Markdown sized for a pull-request comment.

**Engine**

- BM25F scoring over `name` and `description` as separately weighted fields — the routing surface an agent actually sees. Bodies are never indexed.
- Porter (1980) stemmer and a two-tier stop-word system separating English function words from skill boilerplate.
- Dependency-free restricted YAML parser reporting precise line numbers, rejecting anchors, aliases and tags rather than mis-parsing them.
- Automatic discovery across eight conventional skill roots.
- Configuration via `skillsonar.config.json` with load-time validation of every option and range.
- Public library API for embedding the engine.

### Security

- Zero runtime dependencies.
- Symlinks are not followed by default; a real-path visited set prevents cycles when they are.
- Bounded directory traversal.
- Nothing read is ever executed, and no network request is ever made.

### Notes on the model

Two design decisions made during development are worth recording, because both correct mistakes that look reasonable:

- **Collisions are measured as contested mass, not cosine similarity.** Cosine punishes a skill for having extra vocabulary, so a thorough description that fully contains a vague one reads as loosely similar while the vague skill is in fact completely shadowed. On this project's own example collection, cosine reported 41% for a pair the router then split by an 8% margin.
- **Thresholds derived from IDF are ratios, never absolute values.** IDF depends on collection size, so an absolute score floor reported a perfect two-way tie in a two-skill collection as "no match", and an absolute IDF floor flagged every skill in any collection of three. Both are now scale-free.

[Unreleased]: https://github.com/hamodywe/skillsonar/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hamodywe/skillsonar/releases/tag/v0.1.0
