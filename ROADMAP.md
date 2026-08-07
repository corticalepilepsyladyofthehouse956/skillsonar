# Roadmap

Ordered by how much each would improve the answer to the question this tool exists for: *are these skills distinguishable?*

Dates are deliberately absent. Items move when they are ready.

---

## Now — toward 1.0

**Calibration against real collections.**
The thresholds are reasoned rather than measured. They need checking against large, real, messy skill collections — particularly for false positives on collections with legitimate domain overlap, like ten skills that all handle PDFs. This is the single highest-value contribution anyone can make, and it is why [CONTRIBUTING.md](CONTRIBUTING.md) asks for it first.

**A `fix` command.**
Several findings have a mechanical remediation: SR005 name/directory mismatches, SR017 typos in frontmatter keys. `skillsonar fix --dry-run` would show the diff, `skillsonar fix` would apply it. Nothing that rewrites a description — that is a judgement call and belongs to the author.

**Query-set generation.**
`skillsonar init` currently writes a placeholder suite. It could generate a starting suite from the collection itself: signature queries per skill, plus adversarial near-misses drawn from the nearest neighbours. That turns writing routing tests from a blank page into an editing task.

**Stable 1.0.**
Once the report schema and rule ids have survived contact with enough real collections to be worth committing to.

---

## Next

**MCP tool descriptions.**
The routing engine is format-agnostic; only discovery and validation assume `SKILL.md`. MCP servers have exactly the same problem — tool descriptions competing for the same requests — and the same analysis applies unchanged. Blocked on a stable way to enumerate tool definitions without connecting to a live server.

**Watch mode.**
`skillsonar watch` re-analysing on save, so the feedback arrives while a description is being written rather than in CI. The analysis already runs in milliseconds; this is mostly plumbing.

**Editor integration.**
An LSP server exposing collisions as diagnostics on the `description` line, with the competing skill named in the hover. The library API exists for exactly this.

**Cross-collection analysis.**
Comparing a skill against a *published* corpus rather than only the local one, to answer "will this collide with what people already have installed" before publishing.

---

## Later

**Semantic collisions.**
Lexical analysis cannot see that "car" and "automobile" collide. An optional embedding-backed mode would catch those. Explicitly optional: the properties that make this tool worth running on every commit — instant, free, deterministic, offline — all come from not having a model, and none of them will be given up for the default path.

**Multilingual stemming.**
Stop words and the Porter stemmer are English. Other languages tokenize correctly today but do not conflate morphological variants. Snowball stemmers for major languages would fix that, and would need to stay dependency-free.

**Trigger-eval integration.**
Read the output of a real trigger-eval run and use it to calibrate the thresholds *for your collection*, rather than shipping one set of constants for everyone. This is the most principled long-term answer to the calibration problem, and the most work.

---

## Explicitly not planned

**Replacing trigger evals.** This measures whether descriptions carry enough signal; evals measure what a model does. Different questions, both worth answering. Any framing that positions this as a substitute would be dishonest.

**Rewriting descriptions automatically.** A description is an author's statement of intent. The tool can report that two are indistinguishable and name the terms involved; deciding what a skill is for is not its job.

**Competing with single-file linters.** Frontmatter validation, secret scanning and link checking are well covered by existing tools. The structural rules here exist so a single command gives a complete picture, not to displace anything. Running both together is reasonable.

**A hosted service, a dashboard, or telemetry.** It is a CLI. It reads files and prints findings.

---

Have a use case that is not here? [Open an issue](https://github.com/hamodywe/skillsonar/issues) — particularly if you have a collection where the current output is wrong.
