<div align="center">

# skillsonar

**Static routing analysis for AI agent skills.**

Find the collisions that stop your `SKILL.md` files from firing — deterministically, offline, in milliseconds.

[![CI](https://github.com/hamodywe/skillsonar/actions/workflows/ci.yml/badge.svg)](https://github.com/hamodywe/skillsonar/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/skillsonar.svg)](https://www.npmjs.com/package/skillsonar)
[![node](https://img.shields.io/node/v/skillsonar.svg)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](package.json)

</div>

---

## The problem

Your skill isn't broken. It just never runs.

Agent Skills use progressive disclosure: at startup an agent loads only each skill's `name` and `description` — roughly 30–50 tokens apiece — and decides from those alone whether to read the body. Your five hundred lines of carefully written instructions contribute **nothing** to whether the skill is ever selected.

So when a skill doesn't fire, the body is the wrong file to debug. The real failure is upstream, in a decision made between descriptions you probably haven't read side by side since you wrote them.

That failure has a name — *skill collision* — and it scales badly. In a large collection, dozens of skills mention "security" and dozens more mention "debugging". Every new skill has to be positioned against every incumbent, and the words that felt distinctive when you wrote one become the words everything shares. Today the fix is to notice a routing error in production, guess which description caused it, edit, and hope.

The measurement tools that exist all sample the model: write twenty labelled queries, run the agent three times each, compute trigger rates. That is the right way to observe model behaviour and it is genuinely useful — but it costs sixty API calls, several minutes, and a tolerance for nondeterminism that makes it unpleasant to gate a pull request on. It also tests **one skill against a yes/no label**, not *which of your fifty skills wins*.

`skillsonar` answers a narrower question with certainty instead of a broader one with noise: **given these descriptions as written, is there enough information here to tell these skills apart?**

That question has a deterministic answer, and finding it takes milliseconds.

---

## What it does

```
$ skillsonar scan

  skillsonar  ·  6 skills  ·  .claude/skills

  ▲  SR011 routing-collision document-parser
     57% of its routing weight is also claimed by "pdf-extract" (only 37% the other way — this skill
     is the one being shadowed)
     → Both descriptions lean on: digital, document, extract, fields, format. Only "document-parser"
       mentions: parse, parser, supports. Only "pdf-extract" mentions: even, file, form, handles (+7
       more). Lead each description with the terms unique to it, and state explicitly what the skill
       is not for.
     .claude/skills/document-parser/SKILL.md:1

  ·  SR009 description-not-intent-framed security-review
     description reads as a capability blurb rather than a trigger condition
     → Lead with when to act: "Use when the user ..." routes more reliably than "Handles ...".
     .claude/skills/security-review/SKILL.md:3

  Routing collisions

     57%  document-parser                   ↔ pdf-extract                       high

  Context budget

    resident  ~381 tokens (0.19% of 200,000, loaded every request)
    deferred  ~1,551 tokens (bodies, loaded on trigger)

  1 warning  ·  1 info
```

Ask what happens to a specific request, and see the scores behind the answer:

```
$ skillsonar route "extract the tables from this scanned document"

  query  extract the tables from this scanned document

   1. document-parser ████████████████████████   2.25
      on document:0.83  extract:0.53  scanned:0.53  tables:0.36
   2. pdf-extract     ██████████████████████▏    2.07
      on extract:0.70  document:0.63  scanned:0.45  tables:0.30
   3. sql-migration   ███▏                       0.30
      on tables:0.30

  ambiguous  margin 8%, coverage 59% — top two are effectively tied — selection here is arbitrary
```

An 8% margin is not a win. It is a coin flip that happens to have landed one way in a deterministic scorer, and there is no reason to expect a model to land the same way twice.

Ask *why* a skill wins or loses, term by term:

```
$ skillsonar explain threat-model

  Routing vocabulary (across 6 skills)

    model         ████████████████  2.31  unique to this skill
    threat        ████████████████  2.31  unique to this skill
    architecture  ██████████▋       1.54  unique to this skill
    boundary      ██████████▋       1.54  unique to this skill
    attack        ██████████▋       1.54  unique to this skill
```

Terms shared across most of the collection are dimmed, because their numeric contribution overstates how much they actually distinguish anything.

---

## Install

```bash
npm install -g skillsonar     # or: npx skillsonar
```

Requires Node.js 20.10 or newer. **Zero runtime dependencies** — deliberate, given that this tool is often pointed at skills downloaded from public marketplaces.

---

## Quick start

```bash
skillsonar                                    # scan the current directory
skillsonar scan .claude/skills                # scan a specific path
skillsonar route "convert this spreadsheet"   # who wins this query?
skillsonar explain pdf-tools                  # why does this skill win or lose?
skillsonar collide                            # colliding pairs only
skillsonar budget                             # context cost of the collection
skillsonar rules                              # every rule and its severity
```

Skills are found automatically under `.claude/skills`, `.agent/skills`, `.codex/skills`, `.cursor/skills`, `.gemini/skills`, `.opencode/skills`, `.github/skills` and plain `skills/`.

---

## Routing regression tests

This is the part meant to live in your repository permanently.

The regression it catches is specific and nasty: **you edit one description, and the skill that wins for an unrelated query silently changes.** Nobody notices until a user reports that a completely different feature stopped working.

```bash
skillsonar init      # writes a starter config and test suite
```

```yaml
# skillsonar.tests.yaml
tests:
  - query: reconcile these supplier invoices against our purchase orders
    expect: invoice-reconcile
    minMargin: 0.4          # must lead second place by at least 40%

  - query: add a nullable column to the users table without locking it
    expect: sql-migration

  - query: what is the weather tomorrow
    expect: none            # nothing should claim this

  - query: summarise this report
    expect: doc-summary
    avoid: [doc-extract]    # this rival must not win
```

```
$ skillsonar test

  ✔  reconcile these supplier invoices against our purchase orders
  ✖  extract the tables from this scanned document
     expected "pdf-extract" but "document-parser" won; "pdf-extract" ranked #2 with 2.07
     1. document-parser 2.25   2. pdf-extract 2.07   3. sql-migration 0.30

  ✖  1 of 5 routing tests failed
```

Every failure prints the actual ranking and the scores, which is usually enough to fix the description without running anything again.

Runs in milliseconds, costs nothing, and returns the same answer on every machine.

---

## CI

**Fail the build on routing regressions:**

```yaml
- run: npx skillsonar test
```

**Annotate pull requests inline** — findings appear on the exact line of the diff that introduced them:

```yaml
- run: npx skillsonar scan --sarif > skillsonar.sarif
  continue-on-error: true
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: skillsonar.sarif
```

**Comment on the pull request:**

```yaml
- run: npx skillsonar scan --markdown > report.md
- run: gh pr comment "$PR" --body-file report.md
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Exit codes: `0` clean · `1` findings or failing tests · `2` usage error · `3` internal error.

---

## How it works

```
SKILL.md files
      │
      ▼
┌──────────────┐   name + description only — the body never influences selection,
│  Discovery   │   so indexing it would analyse a decision the agent never makes
└──────┬───────┘
       ▼
┌──────────────┐   case/hyphen/underscore splitting, diacritic folding,
│  Tokenizer   │   stop-word removal, Porter stemming
└──────┬───────┘
       ▼
┌──────────────┐   BM25F over two weighted fields, with corpus IDF —
│    Corpus    │   a word 84 skills share is worth ~1/28th of a word one skill owns
└──────┬───────┘
       ▼
┌──────────────────────────────────────────────────────────┐
│  Router          which skill wins, by what margin         │
│  Collisions      contested mass, in both directions       │
│  Self-probes     does a skill win its own signature?      │
│  Budget          resident vs deferred token cost          │
└──────────────────────────┬───────────────────────────────┘
                           ▼
              terminal · JSON · SARIF · Markdown
```

Three decisions carry most of the weight. Each is explained in [`docs/scoring.md`](docs/scoring.md); briefly:

**Only the routing surface is indexed.** Names and descriptions, nothing else. Indexing bodies would report well-differentiated skills as safe while they collide in production.

**IDF is what makes "everyone uses the same words" measurable.** In a collection where 84 of 100 skills mention "security", that term scores 0.19 while a term unique to one skill scores 5.3 — a 28× difference, computed rather than guessed.

**Collisions are measured as contested mass, not similarity.** Cosine similarity punishes a skill for having extra vocabulary, so a thorough description that fully contains a vague one reads as only loosely similar — while in practice the vague skill is completely shadowed and can never win. This project's own test corpus contained exactly that case: cosine reported 41% on a pair the router then split by an 8% margin. Contested mass asks the question that matters, one direction at a time — *of the routing weight this skill claims, how much does its neighbour also claim?* — and reports which of the two is the one being shadowed.

---

## What this is not

**It does not predict what a model will do.** It is a lexical analyser, not a simulator. What it detects is the condition underneath most routing failures: two descriptions that do not contain enough distinct information for *any* selection mechanism to tell them apart. When it reports an ambiguous pair, the finding is that the information needed to choose is absent from the input — not that some particular model will choose wrongly.

That makes it complementary to trigger evals, not a replacement:

| | `skillsonar` | Trigger evals |
|---|---|---|
| Measures | whether descriptions carry enough signal | what the model actually does |
| Cost | free | API calls per query per run |
| Speed | milliseconds | minutes |
| Determinism | byte-identical every run | sampled, needs repeats |
| Scope | every skill against every other | one skill against a label |
| Good for | every commit | before a release |

Run this in CI on every change; run evals when it matters.

**Other honest limits:**

- **English only.** Stop words and the Porter stemmer are English. Other languages tokenize correctly but are not stemmed, so morphological variants will not conflate.
- **Lexical, not semantic.** "car" and "automobile" are unrelated to it. Synonym-based collisions are invisible.
- **Token counts are estimates**, within roughly 10–15% of a real BPE tokenizer. The error is systematic, so comparisons between skills are considerably more accurate than the absolute figures.
- **Small collections are noisy.** Under about five skills, IDF has little to work with; some rules deliberately stay silent below that threshold.
- **Thresholds are calibrated heuristics.** The defaults are documented and configurable, and every verdict derived from one says so.

---

## Rules

Seventeen rules, each with a stable id, a default severity, and a fix.

| | Rule | Default | What it catches |
|---|---|---|---|
| `SR001` | missing-frontmatter | error | No YAML block — the skill is undiscoverable |
| `SR002` | invalid-frontmatter | error | Malformed YAML, with the line number |
| `SR003` | missing-name | error | No `name` field |
| `SR004` | invalid-name | error | Not lowercase-hyphenated, or over 64 chars |
| `SR005` | name-directory-mismatch | warning | `name` differs from its directory |
| `SR006` | missing-description | error | No `description` — the skill can never be selected |
| `SR007` | description-too-long | error | Over the 1024-character limit |
| `SR008` | description-too-thin | warning | Too short to carry routing signal |
| `SR009` | description-not-intent-framed | info | Capability blurb rather than a trigger condition |
| `SR010` | duplicate-name | error | Two skills shadow each other |
| `SR011` | **routing-collision** | warning | Two skills respond near-identically |
| `SR012` | **signature-stolen** | error | A skill loses a query built from its own strongest terms |
| `SR013` | **weak-routing-signal** | warning | Every term is shared across the collection |
| `SR014` | resident-budget-exceeded | warning | Description costs too much on every request |
| `SR015` | broken-reference | error | Body links to a file that does not exist |
| `SR016` | body-too-long | info | Better split into referenced files |
| `SR017` | unknown-frontmatter-key | info | Usually a typo of a real field |

The three in bold are the ones no single-file linter can produce, because the defect does not live in any one file.

`error` is reserved for defects that make a skill unusable or unroutable. Style, cost and quality signals are `warning` or `info`, so a default CI gate blocks on real breakage and nothing else. Full descriptions and examples: [`docs/rules.md`](docs/rules.md).

---

## Configuration

Optional. `skillsonar.config.json`, discovered by searching upward from the working directory.

```json
{
  "rules": {
    "SR009": "off",
    "SR011": "error"
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
    "maxSkillResidentTokens": 260
  }
}
```

Every rule accepts `"error"`, `"warning"`, `"info"` or `"off"`. Invalid values, unknown keys and contradictory thresholds are rejected at load time with a message naming the file, the option and the valid range — a scoring parameter that is silently out of range does not crash, it just makes every number meaningless.

Full reference: [`docs/configuration.md`](docs/configuration.md).

---

## Library use

The analysis engine is exported for embedding — validating marketplace submissions at upload time, surfacing collisions in an editor as a description is typed, or building a custom report from the raw scores.

```ts
import { analyze, buildCorpus, route, loadConfig } from 'skillsonar';

const config = await loadConfig(process.cwd());
const result = await analyze(['.claude/skills'], config);

for (const collision of result.collisions.collisions) {
  console.log(`${collision.a.skill.name} is ${Math.round(collision.similarity * 100)}% `
    + `contested by ${collision.b.skill.name}`);
}

const ranked = route(result.corpus, 'extract tables from a PDF');
console.log(ranked.ranked[0]?.skill.name, ranked.verdict, ranked.margin);
```

Everything is pure apart from filesystem access, and nothing reaches the network.

---

## FAQ

**Does this replace running trigger evals against a real agent?**
No, and it is not trying to. Evals measure model behaviour; this measures whether the descriptions contain enough information for any model to succeed. The two catch different failures. See the comparison above.

**Why not use embeddings for semantic similarity?**
That would catch synonym collisions this misses. It would also require a model — a download, or an API key and a network call — which would cost the properties that make this useful: instant, free, deterministic, offline, and runnable on every commit. Embeddings are a good idea for a different tool, and a poor trade for this one.

**My skills are in a non-standard directory.**
Pass the path: `skillsonar scan path/to/skills`. Or point at a single file.

**A collision is reported that I know is fine.**
The two skills may genuinely be distinguished by something lexical analysis cannot see. Disable the rule for the repository, or raise the `collisions` thresholds. If it is a systematic false positive, [please open an issue](https://github.com/hamodywe/skillsonar/issues) — the calibration is only as good as the corpora it has seen.

**Why zero dependencies?**
This tool is frequently run against skills downloaded from public marketplaces, where 36% of packages have been found to contain security flaws. A scanner that is trusted to inspect untrusted content should not itself be a transitive-dependency surface. It also means the YAML parser can report "line 4: duplicate key `name`" instead of a generic parse error.

**Can I use it on MCP tool descriptions?**
Not yet — the discovery and validation layers assume `SKILL.md`. The routing engine is format-agnostic and this is on the [roadmap](ROADMAP.md).

---

## Contributing

Bug reports and calibration data are especially welcome: a real collection where a finding is wrong is worth more than any amount of synthetic testing. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/hamodywe/skillsonar.git
cd skillsonar
npm install
npm test          # 95 tests, no network, no fixtures to download
npm run typecheck
npm run selfcheck # run the tool against its own example collection
```

---

## Documentation

- [`docs/rules.md`](docs/rules.md) — every rule, what triggers it, how to fix it
- [`docs/scoring.md`](docs/scoring.md) — the retrieval model, and why each choice was made
- [`docs/configuration.md`](docs/configuration.md) — full config reference
- [`docs/ci.md`](docs/ci.md) — CI recipes for GitHub Actions, GitLab and pre-commit
- [`examples/collision-demo`](examples/collision-demo) — a deliberately broken collection to experiment on
- [ROADMAP.md](ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md) · [SECURITY.md](SECURITY.md)

---

## Prior art

Several excellent linters validate individual `SKILL.md` files — frontmatter, description quality, token budgets, secrets, broken links. `skillsonar` deliberately does not compete with them on that ground, and running both together is reasonable.

What it adds is the corpus-level layer: routing collisions, contested mass, self-probes, and regression tests over a whole collection. Those findings are invisible to any tool that looks at one file at a time, because the defect is not in any one file.

---

## License

[MIT](LICENSE) © hamodywe
