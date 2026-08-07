# Security policy

## Reporting a vulnerability

Report privately through [GitHub Security Advisories](https://github.com/hamodywe/skillsonar/security/advisories/new). Please do not open a public issue.

Include the version, a reproduction, and what an attacker gains. Expect an acknowledgement within 72 hours and an assessment within seven days.

## Threat model

`skillsonar` is frequently pointed at **untrusted input**. Skill packs are downloaded from public marketplaces where the barrier to publishing is a Markdown file and a week-old account, and where roughly a third of published skills have been found to contain security flaws. The tool's design assumes the files it reads are hostile.

Concretely, it is assumed an attacker fully controls the contents and structure of a scanned directory.

### What the tool does

- Reads files from paths given on the command line.
- Writes only to paths the user explicitly requests (`init`, or shell redirection).
- **Never executes anything it reads.** Skill bodies are text to be counted and parsed, never interpreted.
- **Never makes a network request.** There is no telemetry, no update check, and no analytics.
- Requires no credentials and reads no environment variables other than `NO_COLOR`, `FORCE_COLOR`, `TERM` and `SKILLSONAR_DEBUG`.

### Deliberate hardening

**Zero runtime dependencies.** The main supply-chain risk in a scanner is the scanner's own dependency tree. There is none. Dev dependencies are TypeScript and its type definitions.

**Symlinks are not followed by default.** A symlink inside a downloaded skill pack can point at `/`, at a home directory, or at a sibling repository, turning a scan into an unbounded traversal of the filesystem. `--follow-symlinks` is opt-in, and even then a real-path visited set prevents cycles.

**Bounded traversal.** Directory depth is capped (default 8) and heavy directories such as `node_modules` are skipped.

**The YAML parser is a deliberate subset.** Anchors, aliases, tags and complex keys are rejected rather than partially implemented. Beyond avoiding mis-parsing, this structurally rules out billion-laughs style expansion attacks: there is no alias mechanism to expand.

**No code paths that evaluate content.** No `eval`, no `new Function`, no dynamic `import()` of scanned paths, no shelling out.

**Prompt injection is out of scope by construction.** Skill bodies can and do contain adversarial instructions aimed at language models. `skillsonar` never sends anything to a model, so those instructions are inert text.

### Known limits

- A pathological input can consume CPU proportional to its size. Collision analysis is O(n²) in the number of skills, which is fine for the hundreds a real collection contains and would be slow for tens of thousands.
- Findings are advisory. A clean report means the descriptions are lexically distinguishable; it is not a statement about whether a skill is safe or trustworthy. Use a dedicated skill security scanner for that — this tool answers a different question.
- Output written to a terminal contains text from scanned files. It is truncated and never interpreted, but a terminal with unusual escape handling is outside what can be controlled from here.

## Supported versions

Pre-1.0: only the latest minor receives fixes. After 1.0, the current and previous minor.

## Verifying a release

Releases are published from CI with npm provenance:

```bash
npm view skillsonar dist-tags
npm audit signatures
```
