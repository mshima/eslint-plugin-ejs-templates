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
 *   output its own tests render.
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
    if (chunk.kind === 'text') {
      const value = level === 'whitespace' ? chunk.value.replace(/\s+/gu, '') : chunk.value;
      if (value === '') continue;
      if (code) flush();
      texts += value;
    } else if (chunk.kind === 'eval') {
      // The code tags in a row are one run of code, however a fix splits or joins them.
      if (texts !== '') flush();
      code ??= [];
      code.push(...(level === 'texts' ? [] : tokensOf(chunk.code)));
    } else {
      flush();
      const kind = level === 'escaping' ? 'output' : chunk.kind;
      lines.push(level === 'texts' ? kind : `${kind} ${JSON.stringify(tokensOf(chunk.code))}`);
    }
  }
  flush();
  return lines.join('\n');
}
