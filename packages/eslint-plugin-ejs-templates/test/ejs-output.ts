// Copyright 2026 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import ejs from 'ejs';
import { parseJavaScript, type SyntaxNode } from 'ejs-template-parser';

/**
 * How closely a fixed template must keep what EJS compiles the template to, the function rendering it, which EJS
 * still compiles at every level when it compiled the template:
 * - `exact`: the same texts, code and outputs, the code token by token (its whitespace, comments and semicolons aside,
 *   EJS separating the code of its tags with semicolons);
 * - `whitespace`: the same, the whitespace of the texts aside: a fix slurping a blank line, or moving a tag to a line
 *   of its own;
 * - `escaping`: the same, escaped and raw outputs alike (`prefer-encoded`);
 * - `texts`: the same texts, with code and outputs at the same places, whatever their code: a fix of a JavaScript
 *   rule, which changes the code of tags alone;
 * - `compiles`: nothing more: a fix restructuring tags and texts (`prefer-output`, `no-negated-condition`), whose
 *   branches `renderBranches()` renders, fix by fix (`conditionalParts()`).
 *
 * The semicolons are left aside, so a fix splitting a statement between two tags keeps the tokens: EJS separates the
 * code of its tags with semicolons, and only compiling tells `});` from `}` and `);` in tags of their own.
 */
export type OutputLevel = 'exact' | 'whitespace' | 'escaping' | 'texts' | 'compiles';

type Chunk = { kind: 'text'; value: string } | { kind: 'eval' | 'escaped' | 'raw'; code: string };

/**
 * What EJS compiles a template to, chunk by chunk, as `generateSource()` appends them to the source of the template
 * function: `    ; __append("…")` for a text, `    ; ` and the code of a code tag, `    ; __append(escapeFn(…))` or
 * `    ; __append(…)` for an output tag. The mode EJS reads the template in tells which one a chunk is.
 */
function chunksOf(text: string): Chunk[] | Error {
  const template = new ejs.Template(text, { compileDebug: false });
  const chunks: Chunk[] = [];
  let source = '';
  Object.defineProperty(template, 'source', {
    get: () => source,
    set: (value: string) => {
      const added = value.slice(source.length);
      source = value;
      if (added === '') return;
      switch (template.mode) {
        case 'eval':
          chunks.push({ kind: 'eval', code: added.slice('    ; '.length, -'\n'.length) });
          break;
        case 'escaped':
          chunks.push({ kind: 'escaped', code: added.slice('    ; __append(escapeFn('.length, -'))\n'.length) });
          break;
        case 'raw':
          chunks.push({ kind: 'raw', code: added.slice('    ; __append('.length, -')\n'.length) });
          break;
        default: {
          // A text, or a literal `<%%`, `%%>`: written as EJS escapes it in a string.
          const escaped = added.slice('    ; __append("'.length, -'")\n'.length);
          const value = escaped.replace(/\\([\\nr"])/gu, (_match, char: string) =>
            char === 'n' ? '\n' : char === 'r' ? '\r' : char,
          );
          chunks.push({ kind: 'text', value });
        }
      }
    },
  });
  try {
    template.generateSource();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return chunks;
}

/**
 * The tokens of some code: its whitespace, comments, semicolons and the nodes tree-sitter adds to recover aside. A
 * token of whitespace alone is left aside too, but in a string: in the code of a tag closing a comment another tag
 * opens, tree-sitter reads the blank after the end of the comment as a regular expression.
 */
function tokensOf(code: string): string[] {
  const tree = parseJavaScript(code);
  try {
    const tokens: string[] = [];
    const visit = (node: SyntaxNode): void => {
      if (node.type === 'comment' || node.isMissing) return;
      if (node.childCount === 0) {
        if (node.text !== ';' && (node.text.trim() !== '' || node.type === 'string_fragment')) tokens.push(node.text);
        return;
      }
      for (const child of node.children) visit(child);
    };
    visit(tree.rootNode);
    return tokens;
  } finally {
    tree.delete();
  }
}

/** The character a JavaScript escape sequence writes: `\n`, `\t`, `\x41`, `\u0041`, `\'`. */
function unescape(sequence: string): string {
  const char = sequence[1];
  if (char === 'x' || char === 'u')
    return String.fromCodePoint(Number.parseInt(sequence.slice(2).replace(/[{}]/gu, ''), 16));
  const control: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };
  return control[char] ?? char;
}

/**
 * The value of an output tag whose code is a string literal alone, which it renders as a text would: what
 * `escapeText()` of the parser writes the blanks a delimiter would slurp with (`<%- '  ' %>`).
 */
function literalOf(code: string): string | undefined {
  const tree = parseJavaScript(code);
  try {
    const { rootNode } = tree;
    if (rootNode.hasError || rootNode.namedChildCount !== 1) return undefined;
    const [statement] = rootNode.namedChildren;
    if (statement.type !== 'expression_statement' || statement.namedChildCount !== 1) return undefined;
    const [literal] = statement.namedChildren;
    if (literal.type !== 'string') return undefined;
    return literal.namedChildren
      .map((part) => (part.type === 'escape_sequence' ? unescape(part.text) : part.text))
      .join('');
  } finally {
    tree.delete();
  }
}

/** A text as `<%=` writes it, escaped as `escapeXML` of EJS escapes it. */
const escapeXML = (value: string): string =>
  value.replace(
    /[&<>'"]/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[char] ?? char,
  );

/** Whether EJS compiles a template into a function, the JavaScript of its tags included. */
function compiles(text: string): boolean {
  try {
    ejs.compile(text, { compileDebug: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * What EJS compiles a template to, at a level: whether it compiles, then one line by text, by run of code tags and by
 * output tag. Two templates EJS renders alike at that level give the same lines.
 */
export function ejsOutput(text: string, level: OutputLevel): string {
  const status = compiles(text) ? 'compiles' : 'does not compile';
  const chunks = chunksOf(text);
  // Delimiters EJS does not match, which it stops at.
  if (chunks instanceof Error || level === 'compiles') return status;
  const lines: string[] = [status];
  let texts = '';
  let code: string[] | undefined;
  const flush = (): void => {
    if (texts !== '') lines.push(`text ${JSON.stringify(texts)}`);
    if (code) lines.push(`code ${JSON.stringify(code)}`);
    texts = '';
    code = undefined;
  };
  for (const chunk of chunks) {
    // A text, or an output of a string literal alone, which renders it as a text would.
    let value: string | undefined;
    if (chunk.kind === 'text') {
      value = chunk.value;
    } else if (chunk.kind !== 'eval') {
      const literal = literalOf(chunk.code);
      value = literal !== undefined && chunk.kind === 'escaped' && level !== 'escaping' ? escapeXML(literal) : literal;
    }
    if (value !== undefined) {
      if (level === 'whitespace') value = value.replace(/\s+/gu, '');
      if (value === '') continue;
      if (code) flush();
      texts += value;
    } else if (chunk.kind === 'eval') {
      // The code tags in a row are one run of code, however a fix splits or joins them.
      if (texts !== '') flush();
      code ??= [];
      code.push(...(level === 'texts' ? [] : tokensOf(chunk.code)));
    } else if (chunk.kind !== 'text') {
      flush();
      const kind = level === 'escaping' ? 'output' : chunk.kind;
      lines.push(level === 'texts' ? kind : `${kind} ${JSON.stringify(tokensOf(chunk.code))}`);
    }
  }
  flush();
  return lines.join('\n');
}

/** The variable the condition of a fix is written as in `conditionalParts()`, which `renderBranches()` sets. */
const CONDITION = 'fixedCondition';

/** A value standing for anything: callable, iterable and empty, its properties anything. */
const anything: unknown = new Proxy(() => undefined, {
  get: (_target, key) => {
    if (key === Symbol.toPrimitive) return () => 'anything';
    if (key === Symbol.iterator) return () => [][Symbol.iterator]();
    return key === 'length' ? 0 : anything;
  },
  apply: () => anything,
});

/** The names of the function EJS compiles, which the data of a render must leave to it. */
const FUNCTION_NAMES = new Set(['escapeFn', 'include', 'rethrow', 'locals']);

/** The data of a render: the condition of `conditionalParts()`, every other variable anything. */
function dataWith(condition: boolean): Record<string, unknown> {
  return new Proxy<Record<string, unknown>>(
    {},
    {
      // EJS reads the variables of a template in the data (`with`), but its own and the globals.
      has: (_target, key) =>
        typeof key === 'string' && !key.startsWith('__') && !FUNCTION_NAMES.has(key) && !(key in globalThis),
      get: (target, key) => {
        if (typeof key !== 'string') return undefined;
        if (key === CONDITION) return condition;
        return Object.hasOwn(target, key) ? target[key] : anything;
      },
    },
  );
}

/**
 * What a part of a template renders, its condition (`conditionalParts()`) true, then false, every other variable
 * standing for anything: a line by value. Undefined when the part does not render alone: an `include`, a variable used
 * as what anything cannot stand for.
 *
 * EJS 7 copies the data of a render into an object of its own, but with `unsafePrototypeLocals`, which keeps the
 * `Proxy` standing for the variables.
 */
export function renderBranches(part: string): string | undefined {
  try {
    const render = ejs.compile(part, { compileDebug: false, unsafePrototypeLocals: true });
    return [true, false]
      .map((condition) => `${String(condition)}: ${JSON.stringify(render(dataWith(condition)))}`)
      .join('\n');
  } catch {
    return undefined;
  }
}

/** The first tag of a part, which starts with it: its open delimiter, and its code, after the delimiter. */
function firstTag(part: string): { open: string; code: string } | undefined {
  const open = /^<%[_=-]?(?![%#])/u.exec(part)?.[0];
  if (open === undefined) return undefined;
  const close = /[-_]?%>/u.exec(part.slice(open.length));
  return close ? { open, code: part.slice(open.length, open.length + close.index) } : undefined;
}

/** The range in a part of the condition, its parentheses included, of the `if` (or the `} else if`) it opens with. */
function ifCondition(part: string): [number, number] | undefined {
  const tag = firstTag(part);
  if (tag?.open !== '<%' && tag?.open !== '<%_') return undefined;
  // A link parses after an `if` it continues, the block it opens closed.
  const prefix = tag.code.trimStart().startsWith('}') ? 'if (x) {' : '';
  const tree = parseJavaScript(`${prefix}${tag.code}}`);
  try {
    if (tree.rootNode.hasError) return undefined;
    const statement = tree.rootNode.descendantsOfType('if_statement').find((node) => node.startIndex >= prefix.length);
    const condition = statement?.childForFieldName('condition');
    if (!condition) return undefined;
    const offset = tag.open.length - prefix.length;
    return [offset + condition.startIndex, offset + condition.endIndex];
  } finally {
    tree.delete();
  }
}

/** The range in a part of the condition of the ternary the output tag it opens with renders, alone. */
function ternaryCondition(part: string): [number, number] | undefined {
  const tag = firstTag(part);
  if (tag?.open !== '<%=' && tag?.open !== '<%-') return undefined;
  const tree = parseJavaScript(tag.code);
  try {
    const { rootNode } = tree;
    if (rootNode.hasError || rootNode.namedChildCount !== 1) return undefined;
    const [statement] = rootNode.namedChildren;
    const ternary =
      statement.type === 'expression_statement' && statement.namedChildCount === 1 ? statement.namedChildren[0] : null;
    const condition = ternary?.type === 'ternary_expression' ? ternary.childForFieldName('condition') : null;
    return condition ? [tag.open.length + condition.startIndex, tag.open.length + condition.endIndex] : undefined;
  } finally {
    tree.delete();
  }
}

/**
 * The part of a template a fix of a condition rewrites, before and after it, its condition written `fixedCondition`
 * for `renderBranches()` to set:
 * - an `if` statement, an `} else if (…) {` link, or an output tag of a ternary, whose condition the fix negates,
 *   swapping its branches (`no-negated-condition`): `!fixedCondition` before, `fixedCondition` after;
 * - an `if` statement the fix writes as an output tag of a ternary (`prefer-output`), or the reverse
 *   (`no-multiline-output`): `fixedCondition` on both sides.
 *
 * A link renders after an `if (false)` it continues. Undefined for another fix.
 */
export function conditionalParts(before: string, after: string): [string, string] | undefined {
  const written = (part: string, [start, end]: [number, number], condition: string): string => {
    const text = `${part.slice(0, start)}(${condition})${part.slice(end)}`;
    return /^<%_?\s*\}/u.test(part) ? `<% if (false) { %>${text}` : text;
  };
  const beforeIf = ifCondition(before);
  const afterIf = ifCondition(after);
  const beforeCondition = beforeIf ?? ternaryCondition(before);
  const afterCondition = afterIf ?? ternaryCondition(after);
  if (!beforeCondition || !afterCondition) return undefined;
  // An `if` and an output tag of a ternary: the same condition; two of a kind: the branches swapped.
  const negated = (beforeIf === undefined) === (afterIf === undefined);
  return [
    written(before, beforeCondition, negated ? `!${CONDITION}` : CONDITION),
    written(after, afterCondition, CONDITION),
  ];
}
