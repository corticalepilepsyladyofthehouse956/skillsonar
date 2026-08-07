/**
 * A dependency-free parser for the YAML subset that skill frontmatter uses.
 *
 * Pulling in a full YAML library was the obvious alternative, and it was
 * rejected for two reasons.
 *
 * The first is supply chain. This tool is often run against skills downloaded
 * from public marketplaces, which is exactly the position where you do not want
 * extra transitive dependencies. `skillsonar` ships with zero runtime
 * dependencies, and that only holds if the parser is ours.
 *
 * The second is error quality. General YAML parsers report "bad indentation at
 * line 4" because they cannot know what the document was supposed to contain.
 * A parser that knows it is reading skill frontmatter can say which key is
 * malformed and what was expected instead.
 *
 * The subset covers what real skills use: nested block maps, block and flow
 * sequences, plain and quoted scalars, folded and literal block scalars,
 * comments, and multi-line plain scalars. Anything outside it — anchors,
 * aliases, explicit tags, complex keys, multiple documents — is reported as a
 * precise error rather than silently mis-parsed. Failing loudly matters here:
 * a description that parses into the wrong shape produces a confident, wrong
 * routing analysis, which is worse than no analysis at all.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

export interface FrontmatterError {
  /** 1-based line number within the source file. */
  readonly line: number;
  readonly message: string;
}

export interface FrontmatterResult {
  /** Parsed frontmatter. Empty when the document has none or failed to parse. */
  readonly data: YamlMap;
  /** True when a `---` delimited block was found at the top of the file. */
  readonly present: boolean;
  /** 1-based line where the frontmatter body starts (the line after the opening `---`). */
  readonly bodyLine: number;
  /** Markdown content following the frontmatter block. */
  readonly body: string;
  readonly errors: readonly FrontmatterError[];
}

interface Line {
  readonly raw: string;
  readonly content: string;
  readonly indent: number;
  /** 1-based line number in the original file. */
  readonly number: number;
}

const UNSUPPORTED_PREFIXES: readonly (readonly [string, string])[] = [
  ['&', 'YAML anchors are not supported in skill frontmatter'],
  ['*', 'YAML aliases are not supported in skill frontmatter'],
  ['!', 'YAML tags are not supported in skill frontmatter'],
  ['?', 'YAML complex keys are not supported in skill frontmatter'],
];

/**
 * Remove a trailing comment, respecting quotes.
 *
 * A `#` only starts a comment when it is at the start of the line or preceded
 * by whitespace, which is what keeps `url: https://x.dev/#anchor` intact.
 */
function stripComment(text: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      // A double quote escaped with a backslash does not close the string.
      if (i > 0 && text[i - 1] === '\\') continue;
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      const prev = i === 0 ? ' ' : text[i - 1];
      if (prev === ' ' || prev === '\t' || i === 0) {
        return text.slice(0, i);
      }
    }
  }

  return text;
}

function indentOf(raw: string): number {
  let n = 0;
  while (n < raw.length && raw[n] === ' ') n += 1;
  return n;
}

function isBlank(line: Line): boolean {
  return line.content.trim().length === 0;
}

/** Decode the escape sequences valid inside a double-quoted YAML scalar. */
function decodeDoubleQuoted(text: string, line: number, errors: FrontmatterError[]): string {
  let out = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }

    i += 1;
    const esc = text[i];
    switch (esc) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case '0': out += '\0'; break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'u': {
        const hex = text.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          errors.push({ line, message: `invalid \\u escape: expected four hex digits, got "${hex}"` });
          out += '\\u';
          break;
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        errors.push({ line, message: `unknown escape sequence "\\${esc ?? ''}"` });
        out += esc ?? '';
    }
  }

  return out;
}

/**
 * Interpret a plain (unquoted) scalar.
 *
 * Type coercion follows YAML's core schema so that `version: 2` is a number and
 * `draft: true` is a boolean. The validator downstream reports a type mismatch
 * with a readable message, which is more useful than silently stringifying and
 * letting a numeric skill name through.
 */
function coercePlainScalar(text: string): YamlValue {
  const trimmed = text.trim();

  if (trimmed === '') return '';
  if (trimmed === 'null' || trimmed === 'Null' || trimmed === 'NULL' || trimmed === '~') return null;
  if (trimmed === 'true' || trimmed === 'True' || trimmed === 'TRUE') return true;
  if (trimmed === 'false' || trimmed === 'False' || trimmed === 'FALSE') return false;
  if (/^[-+]?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) return Number.parseFloat(trimmed);

  return trimmed;
}

function parseQuotedOrPlain(text: string, line: number, errors: FrontmatterError[]): YamlValue {
  const trimmed = text.trim();

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return decodeDoubleQuoted(trimmed.slice(1, -1), line, errors);
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    // In single-quoted YAML the only escape is '' for a literal quote.
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    errors.push({ line, message: 'unterminated quoted string' });
    return trimmed.slice(1);
  }

  return coercePlainScalar(trimmed);
}

/** Parse an inline flow sequence such as `[read, grep, bash]`. */
function parseFlowSequence(text: string, line: number, errors: FrontmatterError[]): YamlValue[] {
  const inner = text.trim().slice(1, -1);
  if (inner.trim() === '') return [];

  const items: YamlValue[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let depth = 0;

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] as string;

    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && inner[i - 1] !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble && (ch === '[' || ch === '{')) depth += 1;
    else if (!inSingle && !inDouble && (ch === ']' || ch === '}')) depth -= 1;
    else if (ch === ',' && !inSingle && !inDouble && depth === 0) {
      items.push(parseQuotedOrPlain(current, line, errors));
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim() !== '') items.push(parseQuotedOrPlain(current, line, errors));
  return items;
}

/**
 * Read a `|` or `>` block scalar.
 *
 * `|` (literal) keeps newlines; `>` (folded) joins wrapped lines with spaces but
 * preserves paragraph breaks. Both accept a `-` (strip) or `+` (keep) chomping
 * indicator controlling trailing newlines.
 */
function readBlockScalar(
  lines: readonly Line[],
  start: number,
  parentIndent: number,
  header: string,
): { value: string; next: number } {
  const folded = header.startsWith('>');
  const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';

  const collected: string[] = [];
  let index = start;
  let blockIndent = -1;

  while (index < lines.length) {
    const line = lines[index] as Line;

    if (line.raw.trim() === '') {
      collected.push('');
      index += 1;
      continue;
    }
    if (line.indent <= parentIndent) break;

    if (blockIndent === -1) blockIndent = line.indent;
    collected.push(line.raw.slice(blockIndent));
    index += 1;
  }

  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();

  let value: string;
  if (folded) {
    const paragraphs: string[] = [];
    let buffer: string[] = [];

    for (const entry of collected) {
      if (entry === '') {
        paragraphs.push(buffer.join(' '));
        buffer = [];
        continue;
      }
      // A more-indented line inside a folded block keeps its own line break.
      if (entry.startsWith(' ') && buffer.length > 0) {
        paragraphs.push(buffer.join(' '));
        buffer = [entry.trim()];
        continue;
      }
      buffer.push(entry.trim());
    }
    if (buffer.length > 0) paragraphs.push(buffer.join(' '));
    value = paragraphs.join('\n');
  } else {
    value = collected.join('\n');
  }

  if (chomp === 'keep') value += '\n';
  else if (chomp === 'clip' && value !== '') value += '\n';

  return { value, next: index };
}

/**
 * Split `key: value` at the first colon that is not inside quotes.
 * Returns `null` when the line is not a mapping entry.
 */
function splitKey(content: string): { key: string; rest: string } | null {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];

    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && content[i - 1] !== '\\') inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) {
      const next = content[i + 1];
      // A colon only ends a key when followed by whitespace or end of line,
      // which keeps values like `url: https://host` from splitting early.
      if (next === undefined || next === ' ' || next === '\t') {
        return { key: content.slice(0, i).trim(), rest: content.slice(i + 1).trim() };
      }
    }
  }

  return null;
}

interface ParserState {
  readonly lines: readonly Line[];
  readonly errors: FrontmatterError[];
}

function nextMeaningful(state: ParserState, from: number): number {
  let i = from;
  while (i < state.lines.length && isBlank(state.lines[i] as Line)) i += 1;
  return i;
}

/**
 * Gather continuation lines of a multi-line plain scalar.
 *
 * A plain scalar continues on following lines that are indented deeper than the
 * key and are not themselves mapping entries or sequence items. Continuations
 * join with spaces, matching YAML folding.
 */
function readPlainContinuation(
  state: ParserState,
  start: number,
  parentIndent: number,
  first: string,
): { value: string; next: number } {
  const parts = first === '' ? [] : [first];
  let index = start;

  while (index < state.lines.length) {
    const line = state.lines[index] as Line;
    if (isBlank(line)) break;
    if (line.indent <= parentIndent) break;

    const trimmed = line.content.trim();
    if (trimmed.startsWith('- ') || trimmed === '-') break;
    if (splitKey(trimmed) !== null) break;

    parts.push(trimmed);
    index += 1;
  }

  return { value: parts.join(' '), next: index };
}

function parseValueAfterKey(
  state: ParserState,
  keyLine: Line,
  rest: string,
  index: number,
): { value: YamlValue; next: number } {
  if (rest.startsWith('|') || rest.startsWith('>')) {
    const block = readBlockScalar(state.lines, index, keyLine.indent, rest);
    return { value: block.value, next: block.next };
  }

  if (rest.startsWith('[') && rest.endsWith(']')) {
    return { value: parseFlowSequence(rest, keyLine.number, state.errors), next: index };
  }

  if (rest.startsWith('{')) {
    state.errors.push({
      line: keyLine.number,
      message: 'inline flow mappings are not supported; use an indented block mapping instead',
    });
    return { value: null, next: index };
  }

  if (rest !== '') {
    const continued = readPlainContinuation(state, index, keyLine.indent, rest);
    // Quoted scalars never span lines here, so only re-parse when nothing was joined.
    if (continued.next === index) {
      return { value: parseQuotedOrPlain(rest, keyLine.number, state.errors), next: index };
    }
    return { value: coercePlainScalar(continued.value), next: continued.next };
  }

  // Empty value: either a nested block starting on the next line, or null.
  const peek = nextMeaningful(state, index);
  if (peek >= state.lines.length) return { value: null, next: index };

  const child = state.lines[peek] as Line;
  if (child.indent <= keyLine.indent) return { value: null, next: index };

  return parseNode(state, peek, child.indent);
}

/** Parse a block sequence: consecutive `- ` entries at `indent`. */
function parseSequence(state: ParserState, start: number, indent: number): { value: YamlValue[]; next: number } {
  const items: YamlValue[] = [];
  let index = start;

  while (index < state.lines.length) {
    const line = state.lines[index] as Line;
    if (isBlank(line)) {
      index += 1;
      continue;
    }
    if (line.indent !== indent) break;

    const trimmed = line.content.trim();
    if (!trimmed.startsWith('-')) break;

    const inline = trimmed === '-' ? '' : trimmed.slice(1).trim();
    index += 1;

    if (inline === '') {
      const peek = nextMeaningful(state, index);
      const child = peek < state.lines.length ? state.lines[peek] : undefined;
      if (child !== undefined && child.indent > indent) {
        const parsed = parseNode(state, peek, child.indent);
        items.push(parsed.value);
        index = parsed.next;
      } else {
        items.push(null);
      }
      continue;
    }

    // `- key: value` starts a mapping whose keys align after the dash.
    const nested = splitKey(inline);
    if (nested !== null) {
      const virtualIndent = indent + 2;
      const map: YamlMap = {};
      const valueLine: Line = { ...line, indent: virtualIndent, content: inline };
      const parsed = parseValueAfterKey(state, valueLine, nested.rest, index);
      map[nested.key] = parsed.value;
      index = parsed.next;

      while (index < state.lines.length) {
        const follow = state.lines[index] as Line;
        if (isBlank(follow)) { index += 1; continue; }
        if (follow.indent <= indent) break;

        const entry = splitKey(follow.content.trim());
        if (entry === null) break;

        const sub = parseValueAfterKey(state, follow, entry.rest, index + 1);
        map[entry.key] = sub.value;
        index = sub.next;
      }

      items.push(map);
      continue;
    }

    items.push(parseQuotedOrPlain(inline, line.number, state.errors));
  }

  return { value: items, next: index };
}

/** Parse a block mapping at `indent`. */
function parseMapping(state: ParserState, start: number, indent: number): { value: YamlMap; next: number } {
  const map: YamlMap = {};
  let index = start;

  while (index < state.lines.length) {
    const line = state.lines[index] as Line;
    if (isBlank(line)) {
      index += 1;
      continue;
    }
    if (line.indent < indent) break;

    if (line.indent > indent) {
      state.errors.push({
        line: line.number,
        message: `unexpected indentation: expected ${indent} spaces, found ${line.indent}`,
      });
      index += 1;
      continue;
    }

    const trimmed = line.content.trim();

    for (const [prefix, message] of UNSUPPORTED_PREFIXES) {
      if (trimmed.startsWith(prefix)) {
        state.errors.push({ line: line.number, message });
        return { value: map, next: state.lines.length };
      }
    }

    const entry = splitKey(trimmed);
    if (entry === null) {
      state.errors.push({
        line: line.number,
        message: `expected "key: value" but found "${trimmed.slice(0, 60)}"`,
      });
      index += 1;
      continue;
    }

    if (entry.key === '') {
      state.errors.push({ line: line.number, message: 'mapping key is empty' });
      index += 1;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(map, entry.key)) {
      state.errors.push({ line: line.number, message: `duplicate key "${entry.key}"` });
    }

    const parsed = parseValueAfterKey(state, line, entry.rest, index + 1);
    map[entry.key] = parsed.value;
    index = parsed.next;
  }

  return { value: map, next: index };
}

function parseNode(state: ParserState, start: number, indent: number): { value: YamlValue; next: number } {
  const line = state.lines[start];
  if (line === undefined) return { value: null, next: start };

  const trimmed = line.content.trim();
  if (trimmed.startsWith('- ') || trimmed === '-') {
    return parseSequence(state, start, indent);
  }
  return parseMapping(state, start, indent);
}

function toLines(source: string, offset: number): Line[] {
  return source.split('\n').map((raw, i) => ({
    raw,
    content: stripComment(raw),
    indent: indentOf(raw),
    number: offset + i,
  }));
}

/**
 * Parse a standalone YAML document using the same restricted subset.
 *
 * Shared with frontmatter parsing so that routing test files and skill
 * metadata accept exactly the same syntax. A user who has written one has
 * already learned the other, and there is only one parser to keep correct.
 */
export function parseYaml(source: string): { data: YamlMap; errors: readonly FrontmatterError[] } {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const errors: FrontmatterError[] = [];
  const state: ParserState = { lines: toLines(text.replace(/\r\n/g, '\n'), 1), errors };

  const first = nextMeaningful(state, 0);
  if (first >= state.lines.length) return { data: {}, errors };

  const data = parseMapping(state, first, (state.lines[first] as Line).indent).value;
  return { data, errors };
}

/**
 * Split a Markdown file into its YAML frontmatter and body, then parse the
 * frontmatter.
 *
 * A byte-order mark is tolerated: files authored on Windows frequently carry
 * one, and rejecting them would produce a baffling "no frontmatter" error on a
 * file that visibly starts with `---`.
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const normalised = text.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n');

  const empty: FrontmatterResult = {
    data: {},
    present: false,
    bodyLine: 1,
    body: normalised,
    errors: [],
  };

  if (lines.length === 0 || (lines[0] as string).trim() !== '---') return empty;

  let closing = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const value = (lines[i] as string).trim();
    if (value === '---' || value === '...') {
      closing = i;
      break;
    }
  }

  if (closing === -1) {
    return {
      data: {},
      present: true,
      bodyLine: 2,
      body: '',
      errors: [{ line: 1, message: 'frontmatter opened with "---" but never closed' }],
    };
  }

  const block = lines.slice(1, closing).join('\n');
  const errors: FrontmatterError[] = [];
  const state: ParserState = { lines: toLines(block, 2), errors };

  const first = nextMeaningful(state, 0);
  const data = first < state.lines.length
    ? parseMapping(state, first, (state.lines[first] as Line).indent).value
    : {};

  return {
    data,
    present: true,
    bodyLine: closing + 2,
    body: lines.slice(closing + 1).join('\n'),
    errors,
  };
}
