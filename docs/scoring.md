# The scoring model

Why `skillsonar` computes what it computes, and what each number is and is not evidence of.

If you only read one section, read [What the numbers do not mean](#what-the-numbers-do-not-mean).

---

## 1. Only the routing surface is indexed

The corpus contains each skill's **`name` and `description`, and nothing else.**

This is the single most consequential decision in the tool, and it is not an approximation.

Agent Skills use progressive disclosure. At startup an agent loads only the name and description of each installed skill and decides from those alone whether to read the body. The body may be five hundred lines of excellent instructions; it contributes nothing to whether the skill is ever selected.

Indexing bodies would therefore analyse a decision the agent never makes. Worse, it would fail in the most misleading direction: two skills whose descriptions are near-identical but whose bodies differ substantially would be reported as well-separated, while colliding in production.

Name and description are indexed as **separate fields** rather than concatenated, so they can be weighted independently. A term in a three-word name is a much stronger signal than the same term buried in a sixty-word description.

---

## 2. Tokenization

```
"parseJSONFile"  →  parse · json · file
"snake_case"     →  snake · case
"kebab-case"     →  kebab · case
"café"           →  cafe
```

Words are extracted, split on case boundaries (`parseJson` → `parse` + `Json`; `HTTPServer` → `HTTP` + `Server`), lowercased, diacritic-folded, filtered against stop lists, and stemmed. Hyphens, underscores and dots are natural separators, so `pdf-extract` indexes as two terms with no special-casing.

Diacritic folding decomposes to NFD and strips the combining-marks block, so "café" and "cafe" index identically. Scripts that do not decompose that way — CJK, Arabic, Hebrew — pass through untouched, which is correct: their characters carry meaning that must not be discarded.

### Stop words, in two tiers

**Ordinary English function words** ("the", "and", "with") are removed purely for speed and readability. IDF would already crush their weight.

**Skill boilerplate** ("skill", "use this when", "agent", "helper", "trigger") is removed because it is *rare in English but ubiquitous in skill descriptions*. IDF suppresses these once a corpus is large enough, but a collection of five or ten skills does not give IDF enough signal, and these words would otherwise dominate similarity. Removing them keeps small-corpus analysis honest.

Both lists are conservative. Anything that could plausibly be a real skill's distinguishing word is left in.

### Stemming

Porter (1980), chosen for properties rather than accuracy: fully deterministic, no dictionary, microseconds, and stable across runs and machines. Those are the properties that make an analysis safe to put in CI and diff between commits.

The purpose is that a user's phrasing and a description written months earlier must land on the same term. "migrating a database" and "database migration" must collide, or the tool reports a clean routing table that falls apart in production.

Words of two characters or fewer pass through unchanged — `ci`, `ai`, `db` are almost always acronyms, and stemming would destroy exactly the terms most likely to be distinctive.

---

## 3. IDF: what makes shared vocabulary measurable

```
idf(t) = ln(1 + (N − df + 0.5) / (df + 0.5))
```

`N` is the collection size, `df` how many skills contain the term.

This is the non-negative BM25 variant. The classic Robertson–Sparck Jones formula turns negative once a term appears in more than half the corpus, which would make a shared word actively *subtract* from a skill's score — nonsense here, where a word every skill uses should be worthless, not harmful.

**This formula is what turns "everyone uses the same words" into a number.** In a hundred-skill collection where 84 mention "security":

| Term | `df` | IDF | Relative |
|---|---|---|---|
| `security` | 84 | 0.19 | 1× |
| `debugging` | 47 | 0.75 | 4× |
| `invoice` | 3 | 3.35 | 18× |
| `iso20022` | 1 | 5.31 | 28× |

Nothing about that ranking is a heuristic. It is arithmetic over your actual collection.

A term absent from the corpus entirely is scored as if `df = 0` — the value a hypothetical unique term would receive — so out-of-vocabulary query words neither help nor silently vanish from explanations.

---

## 4. BM25F

Scoring is BM25F over the two fields:

```
f̃(t,d) = Σ_fields  w_f · tf(t, d_f) / ((1 − b_f) + b_f · len_f / avglen_f)

score(t,d) = idf(t) · f̃ / (k₁ + f̃)
```

BM25F rather than plain BM25 because the routing surface is genuinely structured. Concatenating a three-word name onto a sixty-word description would let the name's terms be diluted by description length normalisation, even though the name is the strongest available signal about what a skill is for. BM25F normalises each field by its own average length, combines with per-field weights, and only then applies saturation — which is the correct order, and not something achievable by repeating name tokens into one field.

| Parameter | Default | Why |
|---|---|---|
| `k1` | 1.2 | Standard IR default. Repeating a word should help a little, then stop helping — that is what saturation encodes. |
| `nameWeight` | 2.5 | Names are short, deliberate and human-chosen; a match there is far more likely to reflect real intent than a match in prose. |
| `descriptionWeight` | 1.0 | Baseline. |
| `nameLengthNormalisation` | 0.35 | Skill names cluster around two or three words, so aggressive normalisation there mostly amplifies noise. |
| `descriptionLengthNormalisation` | 0.75 | Descriptions run from eight words to a hundred and fifty, where normalisation does real work. |

All five are configurable, and all five are validated against a legal range at load time — an out-of-range value does not crash, it just makes every number meaningless.

Scores are **ordinal**. Their absolute magnitude depends on collection size and carries no meaning on its own, which is exactly why the next two sections exist.

---

## 5. Margin and coverage

Two different questions, deliberately separated.

### Margin — *is the winner clear?*

```
margin = (top − runnerUp) / top
```

Relative, not absolute, because raw scores have no fixed scale: a gap of 2.0 is decisive in a corpus scoring around 3 and negligible in one scoring around 40.

| Margin | Verdict | Meaning |
|---|---|---|
| ≥ 30% | `confident` | Clear winner |
| 10–30% | `contested` | Leading, but fragile |
| < 10% | `ambiguous` | Effectively tied — selection is arbitrary |

### Coverage — *did anything actually match?*

```
coverage = topScore / Σ_{t ∈ query} idf(t)
```

The denominator is the highest score any skill could achieve for this query — the ceiling BM25 saturation approaches but never reaches. Coverage is therefore the share of the query's available discriminative weight the winner captured, and it is **scale-free**.

That property matters more than it sounds. An earlier version of this tool used an absolute score floor of 0.35 to decide "nothing matched". Because IDF shrinks as collections shrink, a *perfect two-way tie in a two-skill collection* scored 0.33 and was reported as `no-match`, while a single incidental word in a two-hundred-skill collection would have sailed past the same floor. Exactly backwards. Coverage below `minimumCoverage` (default 0.15) now means no meaningful match, at any collection size.

The same scale-dependence bug appeared independently in the weak-signal rule, which used an absolute IDF floor and consequently flagged every skill in any collection of three. Both are now ratios. If you extend this tool, **be suspicious of any absolute threshold on a quantity derived from IDF.**

---

## 6. Collisions: contested mass

Two skills collide when a router cannot reliably distinguish them.

Everything is computed over **routing response vectors**: for each term, the score a skill would receive if that single term were the entire query. Comparing responses rather than raw text is what makes the number mean something — two skills can share most of their words and remain perfectly distinguishable if the words they *do not* share are the rare ones, and response vectors capture that because IDF has already flattened the common terms.

The measure is **contested mass**, computed one direction at a time:

```
contested(A → B) = Σ_{t ∈ A}  min(score_A(t), score_B(t))  /  Σ_{t ∈ A} score_A(t)
```

*Of the routing weight A claims, how much does B also claim?*

### Why not cosine similarity

Cosine is symmetric, and it punishes a skill for having extra vocabulary. A thorough description that fully contains a vague one reads as only loosely similar — while in practice the vague skill is completely shadowed and can never win.

This is not hypothetical. In this project's own example collection, cosine reported **41%** for a pair that the router then split by an **8% margin**: a severe collision reported as mild. Contested mass reports 57% on the same pair, in the direction that matters, and correctly identifies `document-parser` as the skill being shadowed rather than treating the pair as symmetric.

Capping each term at `min(A, B)` keeps the result in `[0, 1]` and makes it conservative: a rival scoring *higher* on a term is not merely contesting it but winning it outright, and this measure still counts that as a tie. For a check that can block a build, underreporting is the right direction to err in.

A pair is scored by its **worse direction**, and reported with the shadowed skill first — that is the one whose description has to change.

| Contested | Severity | Meaning |
|---|---|---|
| ≥ 75% | critical | Remaining unique vocabulary is too thin to survive paraphrasing |
| ≥ 55% | high | Distinguishable, but only on specific wording |
| ≥ 40% | moderate | Worth knowing about |
| < 40% | — | Not reported |

---

## 7. Self-probes

The sharpest signal available, and it needs no threshold interpretation.

For each skill, a query is assembled from its own highest-IDF terms and run against the whole collection. If the skill does not win that query, **no realistic phrasing of its own purpose will route to it either** — a neighbour will always be the better lexical match.

Unlike a similarity score, this produces a fact rather than a number requiring judgement: *skill A loses its own signature query to skill B*.

It is deliberately hard to trigger. A skill's own name normally protects it, since names carry 2.5× weight and are usually unique. When SR012 does fire, the skill is genuinely unreachable rather than merely contested — which is why it is an `error` while ordinary collisions are `warning`.

---

## 8. Token estimation

No tokenizer is bundled. A real BPE vocabulary would add megabytes and be wrong for every model whose vocabulary differs from the one shipped.

Instead, a heuristic models how BPE behaves: short frequent words become one token; longer words fragment into pieces of roughly four characters; punctuation is cheap; non-Latin scripts are expensive.

```
word length ≤ 6  →  1 token
word length > 6  →  1 + ⌈(length − 6) / 4⌉
```

The threshold is six rather than four because BPE vocabularies contain whole-word merges for essentially every common English word, and those run to six or seven characters — "should", "before", "because" are each a single token. An earlier version split at four and overestimated ordinary prose by about 25%.

Accuracy is roughly **±10–15%** on English prose, and that figure is printed wherever the numbers are. The error is systematic, so comparisons between skills, and totals as a share of a context window, are considerably more accurate than the absolute figures.

**Resident** cost (name + description + framing overhead) is tracked separately from **deferred** cost (the body), because they behave completely differently: resident cost is paid on every request for every installed skill whether or not it fires, while deferred cost is paid only on trigger. A long body is not a problem. A long *description* is.

---

## What the numbers do not mean

**None of this predicts what a model will do.**

A language model choosing between skills is not running BM25. What it *is* doing is discriminating between short texts on the basis of their overlap with a request — and when two texts are lexically near-identical, no selection mechanism can reliably tell them apart, because the information needed to choose is absent from the input.

That is the class of problem this tool detects. Not *"the model will pick wrong"*, but *"the model has not been given enough to pick right."*

The asymmetry that follows is important, and it is why the thresholds are set conservatively:

- A **large margin is weak evidence** of correct routing. The descriptions are lexically distinct, which is necessary but not sufficient.
- A **near-zero margin is strong evidence** of a genuine defect. There is nothing there to choose on.

Findings are tuned so that `ambiguous` fires only when the top two are within ten percent of each other — well inside the range where the claim holds regardless of which model is doing the choosing.

For measuring what a specific model actually does, run trigger evals. Use this to make sure that when you do, the descriptions are capable of succeeding.
