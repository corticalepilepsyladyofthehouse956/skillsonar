# CLAUDE.md — skillsonar

Guidance for AI agents working in this repository. Human contributors should read [CONTRIBUTING.md](CONTRIBUTING.md), which covers the same ground with more context.

## What this project is

A static analyser for AI agent skills. It answers one question: **given these `SKILL.md` descriptions as written, is there enough information to tell these skills apart?**

It is not a model simulator. Never describe it as predicting what an LLM will do — see the "What this is not" section of the README, and keep any new documentation consistent with it.

## Hard constraints

**Zero runtime dependencies.** Not a preference. The tool is routinely pointed at skills downloaded from public marketplaces, and a scanner trusted with untrusted input must not itself be a dependency surface. Do not add one. Dev dependencies are TypeScript and `@types/node` only.

**Determinism.** Identical input must produce byte-identical output on every machine. No `Date.now()`, no `Math.random()`, no reliance on filesystem enumeration order. Every sort needs a total ordering — several have explicit tie-breaks for exactly this reason. Do not remove them.

**No network, ever.** No telemetry, no update checks, no model calls.

**Nothing read is executed.** Skill bodies are adversarial text. Parse and count them; never interpret them.

## The trap that has caught this project twice

**Any threshold compared against a raw BM25 score or an IDF value is probably a bug.** Both quantities scale with collection size, so an absolute threshold means different things in a 3-skill and a 300-skill collection.

Two real bugs came from this:

- An absolute score floor of `0.35` classified a *perfect two-way tie* in a two-skill collection as "no match", because IDF is tiny when the corpus is. Fixed by replacing it with `coverage` — the share of a query's available weight the winner captured.
- An absolute IDF floor of `1.0` in the weak-signal rule flagged *every skill* in any collection of three, because a term unique to one of three scores 0.98. Fixed by testing the term's *spread* — the fraction of the collection sharing it.

If you introduce a threshold, make it a ratio.

## Test fixtures: the other recurring trap

Skill **names are part of the routing surface** and carry 2.5× weight. A fixture that names two "identical" test skills `doc-parse` and `doc-extract` and then queries for "extract" is testing the name boost, not the property under test.

Four of the five failures during initial development were bad fixtures, not bugs. **When a test fails, work out whether the code or the test is wrong before changing either.** Name fixtures so the property under test is the only thing that varies.

## Architecture

```
src/
  text/         tokenizer, Porter stemmer, stop words
  skills/       discovery, zero-dep restricted YAML parser
  analysis/     corpus + IDF, BM25F, router, collisions, budget
  rules/        rule catalogue, structural checks, routing checks
  testing/      routing regression suite parser and runner
  report/       terminal, JSON, SARIF, Markdown
  cli/          argument parsing
  analyze.ts    orchestrator
  cli.ts        entry point
  index.ts      public API
```

Two rule families, deliberately separated:

- **Structural** (`rules/structure.ts`) — decidable from one file. "Is this valid?" has a right answer.
- **Routing** (`rules/routing.ts`) — only meaningful relative to the whole collection. "Will this win?" depends on everything else installed.

## Model decisions not to undo

Each of these is explained in [`docs/scoring.md`](docs/scoring.md). Read it before changing the engine.

- **Only `name` and `description` are indexed.** Bodies do not influence selection, so indexing them would analyse a decision the agent never makes — and would report colliding skills as safe.
- **BM25F, not BM25.** The routing surface is genuinely two fields with different characteristics. Concatenating them and repeating name tokens is not equivalent.
- **Contested mass, not cosine similarity,** for collisions. Cosine is symmetric and punishes extra vocabulary, so a broad skill that fully shadows a narrow one reads as only loosely similar. On this repo's own example collection cosine said 41% for a pair the router split by 8%.
- **Non-negative IDF.** The classic formula goes negative above 50% document frequency, which would make shared words actively subtract.

## Every finding must be actionable

A diagnostic without a `hint` naming the specific change to make is not finished. Compare:

- ✗ "These skills are 87% similar."
- ✓ "Both lean on: document, extract, fields. Only `document-parser` mentions: parse, supports. Lead each description with the terms unique to it, and state what the skill is not for."

Severity discipline: `error` only for defects that make a skill unusable or unroutable. Style and cost signals are `warning` or `info`. A linter that fails builds over opinions gets switched off.

## Commands

```bash
npm test            # 95 tests, node:test, no network
npm run typecheck
npm run build
npm run selfcheck   # run the tool against examples/collision-demo
```

No build step is needed during development — Node runs the TypeScript directly. Imports use `.ts` extensions; `rewriteRelativeImportExtensions` handles the emit.

`examples/collision-demo` is documentation, and a test asserts it still behaves as its README claims. If you change scoring, that test will tell you.

## Commits

Conventional Commits. Body explains *why*.

```
feat(router): add coverage-based no-match detection
fix(budget): correct token estimate for common short words
```
