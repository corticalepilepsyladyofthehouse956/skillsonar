# Rules

Every finding `skillsonar` can emit, what triggers it, and how to fix it.

Rules are configured by **id**, not title, in `skillsonar.config.json`:

```json
{ "rules": { "SR009": "off", "SR011": "error" } }
```

Valid settings: `"error"`, `"warning"`, `"info"`, `"off"`.

**On severity:** `error` is reserved for defects that make a skill unusable or unroutable — things that are broken, not merely suboptimal. Style, cost and quality signals are `warning` or `info`, so a default CI gate blocks on real breakage and nothing else. A linter that fails builds over opinions gets disabled.

---

## Structural rules

These examine one file in isolation.

### SR001 · missing-frontmatter · `error`

No `---` delimited YAML block at the top of the file.

A skill without frontmatter has no name and no description, so no agent can discover it. When this fires, all other field checks for the file are suppressed — they would be noise.

```markdown
---
name: pdf-extract
description: Use when the user needs structured data pulled out of a PDF.
---
```

### SR002 · invalid-frontmatter · `error`

The block exists but does not parse. Reported with the line number and the specific problem: duplicate key, unterminated string, bad indentation, unsupported construct.

Clients that fail to parse frontmatter skip the skill entirely, so this is always fatal in practice.

Anchors (`&`), aliases (`*`), tags (`!`) and complex keys (`?`) are rejected rather than partially supported — a description that parses into the wrong shape produces a confident, wrong analysis, which is worse than no analysis.

### SR003 · missing-name · `error`

No `name` field, or it is not a string.

If the value looks like a number or boolean, quote it: `name: "2fa-setup"`.

### SR004 · invalid-name · `error`

The name is not lowercase-hyphenated, or exceeds 64 characters.

Valid: `pdf-form-filler`, `sql-migration`, `oauth2-setup`
Invalid: `PDF_Extract`, `pdf extract`, `pdf--extract`, `-pdf`

### SR005 · name-directory-mismatch · `warning`

`name` differs from the containing directory.

Clients that resolve skills by directory will load a different skill than the name suggests. Rename one to match the other.

### SR006 · missing-description · `error`

No `description` field, or it is not a string.

This is the field an agent uses to decide whether to load the skill. Without it, the skill can never be selected — the body is unreachable no matter how good it is.

For multi-line text use a folded scalar:

```yaml
description: >
  Use when the user needs invoices matched against purchase orders,
  including when they only say the numbers do not add up.
```

### SR007 · description-too-long · `error`

Over the specification's 1024-character limit. Clients reject or truncate.

The hint states exactly how many characters to remove. Move detail into the body — it is only loaded when the skill actually fires.

### SR008 · description-too-thin · `warning`

Under 40 characters.

Too short to carry routing signal. A terse description loses to any longer neighbour that names the same domain, because there is less for a query to match against. State the concrete trigger conditions and the domain terms a user would actually type.

### SR009 · description-not-intent-framed · `info`

The description reads as a capability blurb rather than a trigger condition.

Guidance across every major client converges here: the agent is answering *when should I act*, not *what does this do*.

```yaml
# triggers unreliably
description: Handles conversion of spreadsheets into other formats.

# triggers reliably
description: >
  Use when the user has a spreadsheet and wants it in another format —
  CSV, TSV, JSON or Parquet — even if they do not name the target format.
```

Detected by looking for trigger phrasings ("use when", "when the user", "if the user", "applies to"). Purely advisory; switch it off if your house style differs.

### SR010 · duplicate-name · `error`

Two or more skills share a `name`.

They shadow each other, and which one loads depends on discovery order — which varies by client and by filesystem. Reported on **every** file involved, since either could be the one that loses.

### SR014 · resident-budget-exceeded · `warning`

Name plus description exceeds `budget.maxSkillResidentTokens` (default 260).

Resident cost is paid on every request for every installed skill, whether or not it ever fires. Trim the description; move detail into the body.

### SR015 · broken-reference · `error`

The body links to a bundled file that does not exist.

Recognises Markdown links and backticked or bare paths into `scripts/`, `references/` and `assets/`. External URLs, `mailto:` and `#anchors` are ignored.

Fatal because the failure happens at the worst moment — mid-task, when the agent tries to follow the link.

### SR016 · body-too-long · `info`

The body exceeds `budget.maxBodyTokens` (default 6000).

Long bodies are more reliably split into files under `references/` and linked, so the agent loads only the section it needs.

### SR017 · unknown-frontmatter-key · `info`

A key no known client recognises — usually a typo of a real field (`descripton`, `alowed-tools`).

Clients ignore unknown keys silently, which is why this is worth surfacing. Custom fields belong under `metadata`.

---

## Routing rules

These are the findings no single-file linter can produce, because the defect does not live in any one file.

### SR011 · routing-collision · `warning` (`error` at critical)

Two skills respond near-identically to the same queries.

Measured as **contested mass** — of the routing weight this skill claims, how much does its neighbour also claim. The finding is directional: the skill reported is the one being *shadowed*, and its description is the one to change.

```
▲  SR011 routing-collision document-parser
   57% of its routing weight is also claimed by "pdf-extract"
   (only 37% the other way — this skill is the one being shadowed)
   → Both descriptions lean on: digital, document, extract, fields, format.
     Only "document-parser" mentions: parse, parser, supports.
     Only "pdf-extract" mentions: even, file, form, handles (+7 more).
```

Severity: ≥75% critical, ≥55% high, ≥40% moderate.

**To fix:** lead each description with the terms unique to it, and state explicitly what the skill is *not* for. Negative boundaries ("not for reviewing existing code — that is `security-review`") are the single most effective edit, because they add discriminating vocabulary and remove ambiguity at the same time.

If a pair genuinely has no distinguishing vocabulary, the honest fix is usually to merge them.

See [`docs/scoring.md`](scoring.md#6-collisions-contested-mass) for why contested mass rather than cosine similarity.

### SR012 · signature-stolen · `error`

The skill loses a query built from its own most distinctive terms.

The highest-confidence finding in the tool, and the only one requiring no threshold interpretation. A query is assembled from the skill's own highest-IDF vocabulary and run against the collection; if the skill does not win it, **no phrasing of its own purpose routes to it** — a neighbour is always the better lexical match.

```
✖  SR012 signature-stolen handler
   loses its own signature query to "document-handler" (0.32 vs 0.32)
   → The query "handler document handling" was built from this skill's own
     most distinctive terms, and "document-handler" still scored higher.
```

Deliberately hard to trigger: a skill's own name normally protects it. When it does fire, the skill is genuinely unreachable rather than merely contested — hence `error`.

**To fix:** add vocabulary only this skill owns. The specific format, tool, protocol or domain it handles that the other one does not.

### SR013 · weak-routing-signal · `warning`

Every term in the skill appears across most of the collection.

Distinct from a collision: the skill is not competing with one neighbour, it is invisible against everything, and no amount of editing a *different* skill will fix it.

Tested on the **spread** of the skill's rarest term — the fraction of the collection sharing it — rather than that term's IDF, so the rule means the same thing at any collection size. Silent below five skills, where "shared by half the collection" means "shared by two" and says nothing.

**To fix:** add concrete nouns. File formats, API names, tools, protocols, domain terms — words no other skill uses.

---

## Suppressing findings

Per repository, in `skillsonar.config.json`:

```json
{ "rules": { "SR009": "off", "SR005": "info" } }
```

`skillsonar` has no inline suppression comments. This is deliberate: the routing rules are corpus-level findings about *relationships between files*, so a comment in one file could not express which relationship it was excusing. If a rule is systematically wrong for your collection, switch it off for the repository — and please [open an issue](https://github.com/hamodywe/skillsonar/issues), since calibration is only as good as the corpora it has seen.
