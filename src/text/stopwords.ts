/**
 * Stop words removed before scoring.
 *
 * Two tiers, because they earn their place for different reasons:
 *
 * - `ENGLISH_STOPWORDS` are ordinary function words. They appear in nearly every
 *   description, so IDF would already crush their weight; removing them early is
 *   purely a performance and readability win.
 *
 * - `SKILL_BOILERPLATE` are words that are *rare in English but ubiquitous in
 *   skill descriptions* ("skill", "use this when", "agent", "helper"). IDF does
 *   suppress them once a corpus is large enough, but small collections of five
 *   or ten skills do not give IDF enough signal, and these words would otherwise
 *   dominate similarity scores. Removing them keeps small-corpus analysis honest.
 *
 * Both lists are deliberately conservative. Anything that could plausibly be the
 * distinguishing word of a real skill is left in.
 */

const ENGLISH: readonly string[] = [
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does',
  'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of',
  'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you',
  'your', 'yours', 'yourself', 'yourselves',
];

const SKILL_BOILERPLATE: readonly string[] = [
  'skill', 'skills', 'use', 'used', 'uses', 'using', 'user', 'agent', 'agents',
  'assistant', 'claude', 'helper', 'help', 'helps', 'please', 'want', 'wants',
  'need', 'needs', 'ask', 'asks', 'asked', 'asking', 'request', 'requests',
  'invoke', 'invoked', 'trigger', 'triggers', 'triggered', 'whenever',
];

export const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set(ENGLISH);
export const SKILL_BOILERPLATE_STOPWORDS: ReadonlySet<string> = new Set(SKILL_BOILERPLATE);

/** Default stop-word set: ordinary English function words plus skill boilerplate. */
export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  ...ENGLISH,
  ...SKILL_BOILERPLATE,
]);
