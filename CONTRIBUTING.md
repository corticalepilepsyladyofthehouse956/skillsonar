# Contributing

Thanks for considering it.

## What is most useful

**Calibration data.** A real skill collection where a finding is wrong — a false positive, or a collision the tool missed — is worth more than any amount of synthetic testing. The thresholds are only as good as the corpora they have been checked against. You do not need to share the skills themselves; the shape of the descriptions and what you expected is enough to start.

**Bug reports** with a minimal reproduction: two or three `SKILL.md` files and the command you ran.

**Rules.** New rules are welcome if they catch something real. Before proposing one, check it is not something an existing single-file linter already covers well — this project's niche is deliberately the corpus-level layer.

## Setup

```bash
git clone https://github.com/hamodywe/skillsonar.git
cd skillsonar
npm install
```

No build step is needed for development. Node runs the TypeScript directly.

```bash
npm test           # 95 tests, no network, nothing to download
npm run typecheck
npm run selfcheck  # run the tool against its own example collection
npm run build      # compile to dist/
```

## Standards

**Zero runtime dependencies.** This is a hard constraint, not a preference. The tool is routinely pointed at skills downloaded from public marketplaces, and a scanner trusted to inspect untrusted content should not itself be a transitive-dependency surface. Dev dependencies are limited to TypeScript and its types.

**Determinism.** Identical input must produce byte-identical output on every machine. That means: no `Date.now()`, no `Math.random()`, no reliance on filesystem enumeration order, and a total ordering on anything sorted. Several existing sorts have explicit tie-breaks for exactly this reason — please keep them.

**Every finding must be actionable.** A diagnostic without a `hint` that names the specific change to make is not finished. "These skills are 87% similar" leaves the reader to work out what to do; naming the shared terms and the surviving unique ones tells them which words to add and which to cut.

**Be suspicious of absolute thresholds.** Any quantity derived from IDF depends on collection size. Two separate bugs in this project came from the same mistake — an absolute score floor that misjudged small collections, and an absolute IDF floor that flagged every skill in a set of three. If a threshold compares against a raw score or IDF value, it is probably wrong; make it a ratio.

**Comments explain why, not what.** The code says what it does. Comments are for the reasoning that is not recoverable from reading it — why BM25F rather than BM25, why contested mass rather than cosine, why a parameter has the value it does.

## Tests

Every behavioural change needs a test. `node:test` only, no framework.

Watch out for one trap that has caught this project repeatedly: **a test fixture that accidentally leaks a distinguishing term**. Skill names are part of the routing surface and carry 2.5× weight, so naming two "identical" test skills `doc-parse` and `doc-extract` and then querying for "extract" tests the wrong thing. Name fixtures so the property under test is the only thing that varies.

When a test fails, work out whether the code or the test is wrong before changing either. Four of the five initial failures in this project were bad fixtures; the fifth was a real bug in the token estimator.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(router): add coverage-based no-match detection
fix(budget): correct token estimate for common short words
docs(scoring): explain why contested mass replaces cosine
test(rules): cover SR013 on small collections
```

Types: `feat` `fix` `docs` `test` `refactor` `perf` `build` `ci` `chore` `security`.

The body explains *why*. Breaking changes use `!` and a `BREAKING CHANGE:` footer.

## Pull requests

1. Branch from `main`.
2. `npm test && npm run typecheck` clean.
3. Update `CHANGELOG.md` under `Unreleased`.
4. Update the docs if behaviour changed. `docs/scoring.md` is the reference for anything touching the model.

If a change alters scoring output, say so explicitly in the PR description and include a before/after from `examples/collision-demo`. Scoring changes ripple into everyone's committed baselines.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
