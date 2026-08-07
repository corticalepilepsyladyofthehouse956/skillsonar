# Collision demo

A deliberately imperfect collection of six skills, for experimenting with the tool.

```bash
cd examples/collision-demo

skillsonar scan
skillsonar route "extract the tables from this scanned document"
skillsonar explain security-review
skillsonar explain threat-model
skillsonar test
```

## What is in here

| Skill | Purpose |
|---|---|
| `pdf-extract` | Realistic, well-written. Collides with `document-parser`. |
| `document-parser` | **Deliberately broken.** A near-duplicate of `pdf-extract`. |
| `invoice-reconcile` | Well-separated — owns invoice, reconciliation and currency vocabulary. |
| `sql-migration` | Well-separated — owns schema, migration and locking vocabulary. |
| `security-review` | **Deliberately weak.** A capability blurb built from generic words. |
| `threat-model` | Well-separated, and states what it is *not* for. |

## What you should see

**`scan`** reports two findings: an `SR011` collision between `document-parser` and `pdf-extract`, and an `SR009` on `security-review` for being phrased as a capability rather than a trigger.

The collision is reported *directionally*. 57% of `document-parser`'s routing weight is claimed by `pdf-extract`, but only 37% the other way — so `document-parser` is the skill being shadowed, and its description is the one to change.

**`route "extract the tables from this scanned document"`** splits the two by an 8% margin. That is not a win; it is a coin flip that happened to land one way in a deterministic scorer. This is what a collision looks like from the query side.

**`explain security-review` versus `explain threat-model`** is the most instructive comparison here. Both are security skills. One is built from words any collection shares; the other names trust boundaries, attack surface and architecture — concepts nothing else here claims — and explicitly excludes reviewing existing code.

**`test`** runs five routing regression tests. **One fails on purpose**, and its `note` explains why. That failure is the demo: a collision that CI would have caught before it shipped.

## Try fixing it

Edit `document-parser`'s description so it owns vocabulary `pdf-extract` does not — a different container format, a different output shape, a different stage of the pipeline. Add a sentence saying what it is *not* for.

Then re-run:

```bash
skillsonar scan          # the SR011 collision should drop or disappear
skillsonar test          # the failing test should pass
```

Watch the margin in `skillsonar route` move as you edit. That number is the whole point of the tool.
