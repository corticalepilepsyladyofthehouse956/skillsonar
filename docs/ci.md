# CI recipes

`skillsonar` is built for CI: no network, no API keys, no state, and byte-identical output for identical input. A full scan of a hundred skills takes well under a second.

**Exit codes:** `0` clean · `1` findings or failing tests · `2` usage error · `3` internal error.

The `2`/`1` split matters — it lets a workflow distinguish *"your skills have problems"* from *"your workflow file has a typo"*.

---

## GitHub Actions

### Gate on routing regressions

The minimum useful setup. Fails the build when an edit changes which skill wins for a tested query.

```yaml
name: skills
on:
  pull_request:
    paths: ['**/SKILL.md', 'skillsonar.tests.yaml']

jobs:
  routing:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npx skillsonar test
```

### Inline annotations on the diff

The highest-value integration. Findings appear as review comments on the exact lines that introduced them, so they are seen while the change is being decided rather than after.

```yaml
jobs:
  analysis:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }

      - name: Analyse skills
        run: npx skillsonar scan --sarif > skillsonar.sarif
        continue-on-error: true    # upload the results even when findings exist

      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: skillsonar.sarif
          category: skillsonar
```

SARIF results carry stable fingerprints, so a finding dismissed in the GitHub UI stays dismissed across unrelated commits.

### Pull-request comment

```yaml
      - run: npx skillsonar scan --markdown > report.md
        continue-on-error: true

      - name: Comment
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh pr comment "${{ github.event.number }}" --body-file report.md
```

The Markdown format is written for a reader who did not run the tool: it leads with the count, collapses detail behind `<details>`, and explains what a collision is before listing any.

### Everything together

```yaml
name: skills
on: [push, pull_request]

jobs:
  skills:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }

      - name: Routing tests
        run: npx skillsonar test

      - name: Full analysis
        run: npx skillsonar scan --sarif > skillsonar.sarif
        continue-on-error: true

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: skillsonar.sarif
```

---

## GitLab CI

```yaml
skills:
  image: node:22-alpine
  script:
    - npx skillsonar test
    - npx skillsonar scan --json > skillsonar.json
  artifacts:
    when: always
    paths: [skillsonar.json]
```

---

## Pre-commit

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: skillsonar
        name: skillsonar
        entry: npx skillsonar test
        language: system
        files: 'SKILL\.md$'
        pass_filenames: false
```

`pass_filenames: false` is required. Routing analysis is corpus-level — passing only the changed files would compare each edited skill against nothing, which is exactly the blind spot the tool exists to remove.

---

## Committing the report as a baseline

Because output is deterministic, the JSON report can be committed and diffed. A pull request then shows precisely which routing relationships a description change disturbed — including ones nobody thought to write a test for.

```yaml
      - run: npx skillsonar scan --json > .skillsonar/report.json
      - run: git diff --exit-code .skillsonar/report.json
```

The report uses paths relative to the scan root and a versioned `schemaVersion`, so it is stable across machines.

---

## Tuning strictness

By default only `error` findings fail the build. Structural breakage and unreachable skills block; style and cost signals do not.

```bash
skillsonar scan                             # exit 1 on errors (default)
skillsonar scan --min-severity warning      # exit 1 on warnings too
skillsonar scan --collision-severity critical   # report only the worst pairs
```

For a collection with intentional overlap — ten skills that all handle PDFs — prefer raising the `collisions` thresholds in config over disabling the rule. That keeps the genuine cases visible.

---

## Adopting on an existing collection

A large collection will report findings on the first run. Adopt incrementally rather than fixing everything at once:

1. Start with `skillsonar test` only, and write routing tests for the queries you already know matter. This locks in current behaviour before changing anything.
2. Add `scan --sarif` with `continue-on-error: true`. Findings become visible on pull requests without blocking.
3. Fix `SR012` first — those skills are genuinely unreachable today.
4. Then `SR011` critical pairs.
5. Only once the count is near zero, drop `continue-on-error`.
