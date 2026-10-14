// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { type EjsCodeTag, type EjsTag, programOf } from './tags.js';
import { errorNodes, type SyntaxNode } from './ts-parser.js';

/**
 * What a diagnostic tells. Errors, what EJS fails on or renders otherwise than written:
 * - `syntax-error`: the template does not parse, a tag left open (on the EjsSyntaxError buildTemplate throws);
 * - `javascript-error`: the JavaScript EJS compiles the template to does not parse, at this tag;
 * - `comment-across-tags`: a block comment opened in a tag and closed in a later one, which comments out what
 *   is in between, and confuses the blocks;
 * - `stray-close-delimiter`: a `%>` (or `-%>`, `_%>`) in a text, which EJS drops; `%%>` writes one.
 *
 * Warnings, a template out of the conventions of eslint-plugin-ejs-templates, each one named after its rule, which
 * reports it (except `unclosed-block` and `unopened-close`):
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
  // A single-line tag is only reported when it closes more than one block, which is what makes `<%_ } } _%>`
  // impossible to place at a single indent depth. A tag that closes one block and opens another (`<%_ } else { _%>`)
  // is an ordinary continuation and is left alone: in a partial template, whose enclosing `if` lives in another file,
  // its code parses as two fragments rather than one continuation.
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

// The comments are looked for inside WASM: walking a whole tree in JavaScript marshals each of its nodes out of WASM.
const commentNodes = (node: SyntaxNode): SyntaxNode[] => node.descendantsOfType('comment');

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

  // The program of the template, which getEjsTags built, parsed once for every use of its tags.
  const firstCode = nodes.find((node): node is EjsCodeTag => node.kind === 'tag' && node.type !== 'comment');
  const program = firstCode && programOf(firstCode);
  if (!program) return diagnostics;
  const { ranges } = program;
  /** The range of the tag a place of the compiled JavaScript is in, or of the one before it; the first one before it. */
  const rangeAt = (index: number) => ranges.findLast(({ start }) => start <= index) ?? ranges[0];
  const root = program.root;
  {
    const reported = new Set<EjsTag>();
    for (const node of errorNodes(root)) {
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
    for (const comment of commentNodes(root)) {
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
  }
  return diagnostics.sort((a, b) => a.offset - b.offset);
}
