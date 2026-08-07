## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, not the patch. Link an issue if there is one. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` clean
- [ ] Tests added for the new behaviour
- [ ] `CHANGELOG.md` updated under `Unreleased`
- [ ] Docs updated if behaviour changed
- [ ] No new runtime dependencies

## Scoring changes

<!--
Delete this section if the change does not touch the analysis engine.

If it does: scoring changes ripple into everyone's committed baselines and CI
results, so please include a before/after from the example collection:

    node src/cli.ts scan examples/collision-demo

State explicitly which findings moved and why that is the correct new answer.
-->

## Determinism

<!--
Delete unless relevant.

Identical input must produce byte-identical output on every machine. If this
change introduces a sort, a map iteration, or anything that could depend on
filesystem enumeration order, say how ties are broken.
-->
