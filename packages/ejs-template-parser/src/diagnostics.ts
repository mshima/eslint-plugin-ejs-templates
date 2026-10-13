// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { EjsCodeTag, EjsTag } from './tags.js';
import { parseJavaScript, type SyntaxNode } from './ts-parser.js';

/**
 * What a diagnostic tells. Errors, what EJS fails on or renders otherwise than written:
 * - `syntax-error`: the template does not parse, a tag left open (on the EjsSyntaxError buildTemplate throws);
 * - `javascript-error`: the JavaScript EJS compiles the template to does not parse, at this tag;
 * - `comment-across-tags`: a block comment opened in a tag and closed in a later one, which comments out what
 *   is in between, and confuses the blocks;
 * - `stray-close-delimiter`: a `%>` (or `-%>`, `_%>`) in a text, which EJS drops; `%%>` writes one.
 *
 * Warnings, a template out of the conventions of eslint-plugin-ejs-templates, each one named after its rule:
 * - `unclosed-block`: a block no tag closes, as in a partial template;
 * - `unopened-close`: a tag closing a block no tag before it opens, as in a partial template;
 * - `prefer-slurping-codeonly`: a `<% %>` tag opening no block, which leaves its blanks and its line break in the
 *   output where `<%_ _%>` slurps them;
 * - `slurp-newline`: a slurp tag with text before it on its line, whose blanks it slurps;
 * - `indent`: a slurp tag on a line of its own not indented two blanks a block it is in;
 * - `prefer-single-line-tags`: a tag of several statements opening or closing blocks over several lines, or one
 *   closing several blocks, for one tag a statement;
 * - `no-comment-empty-line`: a comment tag on a line of its own not closed by `-%>`, which leaves an empty line.
 */
export type EjsDiagnosticCode =
  | 'syntax-error'
  | 'javascript-error'
  | 'comment-across-tags'
  | 'stray-close-delimiter'
  | 'unclosed-block'
  | 'unopened-close'
  | 'prefer-slurping-codeonly'
  | 'slurp-newline'
  | 'indent'
  | 'prefer-single-line-tags'
  | 'no-comment-empty-line';

const ERRORS = new Set<EjsDiagnosticCode>([
  'syntax-error',
  'javascript-error',
  'comment-across-tags',
  'stray-close-delimiter',
]);

export type EjsDiagnostic = {
  code: EjsDiagnosticCode;
  /** `error`: EJS fails or renders otherwise than written; `warning`: out of the conventions. */
  severity: 'error' | 'warning';
  message: string;
  /** Character offset in the template of what the diagnostic is about, a tag or a delimiter. */
  offset: number;
  length: number;
  /** 1-based line of the offset. */
  line: number;
  /** 0-based column of the offset. */
  column: number;
};

/** The 1-based line and 0-based column of an offset of a text. */
const positionOf = (text: string, offset: number) => {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return { line: text.slice(0, lineStart).split('\n').length, column: offset - lineStart };
};

export const diagnosticOf = (
  text: string,
  code: EjsDiagnosticCode,
  message: string,
  offset: number,
  length: number,
): EjsDiagnostic => ({
  code,
  severity: ERRORS.has(code) ? 'error' : 'warning',
  message,
  offset,
  length,
  ...positionOf(text, offset),
});

/** An ESLint directive comment, which the plugin reads as a directive. */
const ESLINT_DIRECTIVE = /^\s*eslint-(?:disable|enable)(?:-next-line)?(?:\s|$)/;

/** The diagnostics of the conventions of a tag, as the rules of eslint-plugin-ejs-templates report them. */
const conventionsOf = (template: string, tag: EjsTag): EjsDiagnostic[] => {
  const diagnostics: EjsDiagnostic[] = [];
  const report = (code: EjsDiagnosticCode, message: string) =>
    diagnostics.push(diagnosticOf(template, code, message, tag.offset, tag.length));
  if (tag.type === 'comment') {
    if (tag.isStandalone && tag.closeDelim !== '-%>' && !ESLINT_DIRECTIVE.test(tag.code)) {
      report('no-comment-empty-line', 'A comment tag on a line of its own leaves an empty line: close it with -%>');
    }
    return diagnostics;
  }
  const multiline = tag.code.includes('\n');
  if (tag.shape === 'code-slurpable' && !multiline) {
    report('prefer-slurping-codeonly', 'A code tag opening no block slurps its blanks and its line break as <%_ … _%>');
  }
  if (tag.shape === 'slurp' && tag.isStandalone && tag.linePrefix !== tag.expectedIndent) {
    report(
      'indent',
      `A slurp tag on a line of its own is indented two blanks a block it is in: ${JSON.stringify(tag.expectedIndent)}`,
    );
  } else if (tag.shape === 'slurp' && !tag.isStandalone && !multiline) {
    report('slurp-newline', 'A slurp tag goes on a line of its own: it slurps the blanks before it');
  }
  const { javascript } = tag;
  if (
    (multiline || javascript.missingOpenBracesCount > 1) &&
    (javascript.hasStructuralBraces || !javascript.multilineTrimmed) &&
    javascript.splitStatements().length > 1
  ) {
    report(
      'prefer-single-line-tags',
      multiline
        ? 'A tag of several statements opening or closing blocks goes in one tag a statement, a line each'
        : 'A tag closing several blocks goes in one tag a block',
    );
  }
  return diagnostics;
};

/**
 * The close delimiters a text has, which EJS drops: outside of a literal, which `<%%` or `%%>` starts and the
 * next close delimiter ends, writing it.
 */
const strayCloseDelimiters = (
  template: string,
  { offset, text }: { offset: number; text: string },
): EjsDiagnostic[] => {
  const diagnostics: EjsDiagnostic[] = [];
  let literal = false;
  for (const match of text.matchAll(/<%%|%%>|[-_]?%>/g)) {
    if (match[0] === '<%%' || match[0] === '%%>') {
      literal = true;
    } else if (literal) {
      literal = false;
    } else {
      diagnostics.push(
        diagnosticOf(
          template,
          'stray-close-delimiter',
          `EJS drops this ${match[0]} of the text: write %%> for a literal one`,
          offset + match.index,
          match[0].length,
        ),
      );
    }
  }
  return diagnostics;
};

/** The nodes of a tree with an error, not the ones inside another one. */
const errorNodes = (node: SyntaxNode): SyntaxNode[] =>
  node.isError || node.isMissing ? [node] : node.children.flatMap(errorNodes);

const commentNodes = (node: SyntaxNode): SyntaxNode[] =>
  node.type === 'comment' ? [node] : node.children.flatMap(commentNodes);

/**
 * The diagnostics of a template, from its texts and tags in order, and the blocks it leaves unclosed and the closes
 * of blocks it does not open. Its JavaScript is compiled as EJS compiles it, a text an `__append`, an output tag the
 * `__append` of its expression, a code tag its code, the blocks of a partial template balanced, and parsed: each error
 * is the one of the tag it is in, or of the one before it.
 */
export function diagnose(
  template: string,
  nodes: ({ kind: 'text'; offset: number; text: string } | EjsTag)[],
  unclosed: EjsCodeTag[],
  unopened: EjsCodeTag[],
): EjsDiagnostic[] {
  const diagnostics: EjsDiagnostic[] = [];
  for (const tag of unclosed) {
    diagnostics.push(
      diagnosticOf(template, 'unclosed-block', 'No tag closes the block this tag opens', tag.offset, tag.length),
    );
  }
  for (const tag of unopened) {
    diagnostics.push(
      diagnosticOf(
        template,
        'unopened-close',
        'This tag closes a block no tag before it opens',
        tag.offset,
        tag.length,
      ),
    );
  }
  for (const node of nodes) {
    diagnostics.push(...(node.kind === 'text' ? strayCloseDelimiters(template, node) : conventionsOf(template, node)));
  }

  let source = `function __ejs_template__() {\n${'{\n'.repeat(unopened.length)}`;
  const ranges: { tag: EjsTag; start: number; end: number }[] = [];
  for (const node of nodes) {
    if (node.kind === 'text') {
      source += ';__append(0)\n';
      continue;
    }
    if (node.type === 'comment') continue;
    // A line comment ending the code ends with a line break, as EJS adds it, before an output tag appends its value.
    let code = node.code.lastIndexOf('//') > node.code.lastIndexOf('\n') ? `${node.code}\n` : node.code;
    // An output tag without the semicolon it ends with, as EJS strips it.
    if (node.type !== 'code') code = `__append(${code.replace(/;(\s*$)/, '$1')})`;
    source += ';';
    ranges.push({ tag: node, start: source.length, end: source.length + code.length });
    source += `${code}\n`;
  }
  source += `${'}\n'.repeat(unclosed.length)}}\n`;
  if (ranges.length === 0) return diagnostics;
  /** The range of the tag a place of the compiled JavaScript is in, or of the one before it; the first one before it. */
  const rangeAt = (index: number) => ranges.findLast(({ start }) => start <= index) ?? ranges[0];
  const tree = parseJavaScript(source);
  try {
    const reported = new Set<EjsTag>();
    for (const node of errorNodes(tree.rootNode)) {
      const { tag } = rangeAt(node.startIndex);
      if (reported.has(tag)) continue;
      reported.add(tag);
      const problem = node.isMissing ? `missing '${node.type}'` : `unexpected '${node.text.slice(0, 40)}'`;
      diagnostics.push(
        diagnosticOf(
          template,
          'javascript-error',
          `The JavaScript of the template does not parse here: ${problem}`,
          tag.offset,
          tag.length,
        ),
      );
    }
    for (const comment of commentNodes(tree.rootNode)) {
      const range = rangeAt(comment.startIndex);
      if (range.start <= comment.startIndex && comment.endIndex > range.end) {
        diagnostics.push(
          diagnosticOf(
            template,
            'comment-across-tags',
            'A comment opened in this tag ends in a later one: what is in between is commented out',
            range.tag.offset,
            range.tag.length,
          ),
        );
      }
    }
  } finally {
    tree.delete();
  }
  return diagnostics.sort((a, b) => a.offset - b.offset);
}
