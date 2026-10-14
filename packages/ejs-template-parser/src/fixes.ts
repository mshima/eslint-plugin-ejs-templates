// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { EjsDiagnostic } from './diagnostics.js';
import type { EjsCodeTag } from './tags.js';
import { type EjsTemplate, liveTemplate } from './template.js';

/** A fix of a template: the text replacing a range of it. */
export type EjsFix = {
  /** The offset in the template of the range replaced. */
  offset: number;
  /** The length of the range: 0 to insert alone. */
  length: number;
  /** The text written in its place. */
  text: string;
};

/** How the fixes of the conventions write the tags they rewrite. */
export type EjsFixOptions = {
  /**
   * `indent`: the lines of the code of a tag spanning lines indented with the tag too, each at the depth of its own
   * blocks; otherwise they stay as written, the tag and its closing delimiter alone indented.
   */
  normalizeContent?: boolean | undefined;
  /**
   * `indent`: the line of the tag and its closing delimiter at the indentation of its depth (the default); otherwise
   * where they are, the lines of its code alone indented with them (`normalizeContent`).
   */
  indentTag?: boolean | undefined;
  /**
   * `indent` with `normalizeContent`: the line where the right operand of a binary expression starts, apart from its left
   * one, is left as written when indented more than the line the expression starts on (`greater`, the default), by any
   * amount, or as much (`greaterOrEqual`, which `@stylistic/indent-binary-ops` asks for some lines); one level more than
   * that line otherwise.
   */
  binaryOperands?: 'greater' | 'greaterOrEqual' | undefined;
  /**
   * `prefer-single-line-tags`: the tags a tag on a line of its own is split into indented at the depth of the tag and
   * of their blocks, as `indent` expects them; otherwise the first one stays where it is, the others at its
   * indentation.
   */
  indentSplitTags?: boolean | undefined;
};

/** The indentation of a block level. */
const INDENT_UNIT = '  ';

/** An operator ending a line, or starting one: a binary expression may span the line break. */
const OPERATOR_ENDING = /[&|?+\-*/%<>=^!]$/;
const OPERATOR_STARTING = /^(?:[&|?+\-*/%<>=^!]|in\s|instanceof\s)/;

/** Whether an operator is at a line break of some code: read line by line, linear in the code. */
const operatorAtLineBreak = (code: string): boolean => {
  const lines = code.split('\n');
  return lines.some(
    (line, index) =>
      (index < lines.length - 1 && OPERATOR_ENDING.test(line.trimEnd())) ||
      (index > 0 && OPERATOR_STARTING.test(line.trimStart())),
  );
};

/**
 * The lines of the code of a tag, from the first one of its code trimmed (0), where the right operand of a binary
 * expression starts, apart from its left one, each with the line the expression starts on: the lines
 * `@stylistic/indent-binary-ops` indents, from the line of the left operand, which normalizeContent accepts indented
 * more than that line (`binaryOperands`) rather than fixing them in turn. The tree of the code is read only when an
 * operator is at a line break.
 */
const binaryOperandLines = (tag: EjsCodeTag): Map<number, number> => {
  const lines = new Map<number, number>();
  if (!operatorAtLineBreak(tag.code)) return lines;
  const { nodes, start } = tag.javascript;
  const trimmed = tag.code.length - tag.code.trimStart().length;
  // The line breaks of the code trimmed, in order: the line of an index, the ones before it.
  const breaks: number[] = [];
  for (let at = tag.code.indexOf('\n', trimmed); at !== -1; at = tag.code.indexOf('\n', at + 1)) breaks.push(at);
  const lineOf = (index: number) => {
    let low = 0;
    let high = breaks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (breaks[middle] < index) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  for (const node of nodes) {
    if (node.type !== 'binary_expression') continue;
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    // A binary expression has its two operands.
    /* v8 ignore next -- @preserve */
    if (!left || !right) continue;
    const rightLine = lineOf(right.startIndex - start);
    if (rightLine === lineOf(left.endIndex - start)) continue;
    const expressionLine = lineOf(node.startIndex - start);
    lines.set(rightLine, Math.min(lines.get(rightLine) ?? expressionLine, expressionLine));
  }
  return lines;
};

/** The text of a tag written at the indentation of its depth, `expectedIndent`, from the start of its line. */
const indentedTag = (
  tag: EjsCodeTag,
  normalizeContent: boolean,
  binaryOperands: 'greater' | 'greaterOrEqual',
  indentTag: boolean,
): string => {
  // The indentation of the tag: the one of its depth, or the one it has.
  const indentation = indentTag ? tag.expectedIndent : tag.linePrefix;
  const tagText = `${tag.openDelim}${tag.code}${tag.closeDelim}`;
  if (!tagText.includes('\n')) return `${indentation}${tagText}`;

  // A tag spanning lines: its code from the opening delimiter and a blank, its lines at the column after them, its
  // closing delimiter on a line of its own at the indentation of the tag.
  const contentLines = tag.code.trim().split('\n');
  const contentIndent = ' '.repeat(indentation.length + tag.openDelim.length + 1);
  const firstLine = contentLines[0].trimStart();
  const lines = [`${indentation}${tag.openDelim} ${firstLine}`];

  const isOpenBlock = (line: string) =>
    line.endsWith('{') || line.endsWith('(') || line.endsWith('[') || line.endsWith('=>');
  const isCloseBlock = (line: string) => line.startsWith('}') || line.startsWith(')') || line.startsWith(']');
  const isContinueStatement = (line: string) => /^[=?:|&><]/.test(line) || /^\.[^.]/.test(line);
  const operandLines = normalizeContent ? binaryOperandLines(tag) : new Map<number, number>();
  /** The indentation of each line written, the first one at the column of the code. */
  const written: number[] = [contentIndent.length];
  let relativeBlockIndent = isOpenBlock(firstLine) ? 1 : 0;
  const relativeStatementIndentStack: number[] = [];
  for (const [index, line] of contentLines.slice(1).entries()) {
    if (!normalizeContent) {
      lines.push(line);
      continue;
    }
    const trimmedLine = line.trimStart();
    const relativeStatementIndent = isContinueStatement(trimmedLine) ? 1 : 0;
    if (isCloseBlock(trimmedLine)) relativeBlockIndent = Math.max(0, relativeBlockIndent - 1);
    const depth = relativeBlockIndent + relativeStatementIndent + (relativeStatementIndentStack.at(-1) ?? 0);
    // The line of a right operand, apart from its left one: as written when indented more than the line the expression
    // starts on, by any amount, or as much (`binaryOperands`); one level more otherwise.
    const expressionLine = operandLines.get(index + 1);
    const lineIndent = line.length - trimmedLine.length;
    let indented: string;
    if (expressionLine === undefined) {
      indented = `${contentIndent}${INDENT_UNIT.repeat(depth)}${trimmedLine}`;
    } else if (
      lineIndent > written[expressionLine] ||
      (binaryOperands === 'greaterOrEqual' && lineIndent === written[expressionLine])
    ) {
      indented = line;
    } else {
      indented = `${' '.repeat(written[expressionLine])}${INDENT_UNIT}${trimmedLine}`;
    }
    lines.push(indented.trimEnd());
    written.push(indented.length - indented.trimStart().length);
    if (isCloseBlock(trimmedLine)) relativeStatementIndentStack.pop();
    if (isOpenBlock(trimmedLine)) {
      relativeStatementIndentStack.push(relativeStatementIndent);
      relativeBlockIndent++;
    }
  }
  lines.push(`${indentation}${tag.closeDelim}`);
  return lines.join('\n');
};

/**
 * The tags a tag of several statements is split into, one a statement, the opening and the closing of each block
 * apart (`splitStatements()`).
 *
 * The tags of a tag after text on its line stay side by side, the delimiters of the tag on the first and the last
 * one, the seams opening as the tag closes (`<%_` for `_%>`, otherwise `<%`), which keeps the blanks between them
 * none. The tags of a tag on a line of its own go a line each, joined by `_%>` and `<%_`, which slurp the line breaks
 * and the indentation between them: at the depth of the tag and of their blocks with `indentSplitTags`, otherwise at
 * the indentation of the tag.
 */
const splitTags = (tag: EjsCodeTag, indentSplitTags: boolean): string => {
  const statements = tag.javascript.splitStatements();
  if (!tag.isStandalone) {
    const seamOpenDelim = tag.closeDelim === '_%>' ? '<%_' : '<%';
    return statements
      .map((statement, index) => `${index === 0 ? tag.openDelim : seamOpenDelim} ${statement.trim()} ${tag.closeDelim}`)
      .join('');
  }
  const delimitersOf = (index: number) => ({
    openDelim: index === 0 ? tag.openDelim : '<%_',
    closeDelim: index === statements.length - 1 ? tag.closeDelim : '_%>',
  });
  if (!indentSplitTags) {
    return statements
      .map((statement, index) => {
        const { openDelim, closeDelim } = delimitersOf(index);
        return `${index === 0 ? '' : tag.linePrefix}${openDelim} ${statement} ${closeDelim}`;
      })
      .join('\n');
  }
  let depth = 0;
  return statements
    .map((statement, index) => {
      const { openDelim, closeDelim } = delimitersOf(index);
      const trimmed = statement.trim();
      if (index > 0 && trimmed.startsWith('}')) depth = Math.max(0, depth - 1);
      const line = `${tag.expectedIndent}${INDENT_UNIT.repeat(depth)}${openDelim} ${trimmed} ${closeDelim}`;
      if (trimmed.endsWith('{')) depth++;
      return line;
    })
    .join('\n');
};

/**
 * The fix of a convention of a tag, the one of a diagnostic of a template buildTemplate built (`validateTemplate`),
 * before cleanupTemplate frees it: the code of the convention and the offset of the tag, which any tag can be given
 * for its convention, the fix then undefined when it changes nothing. Undefined for a code of no fix, or of another
 * kind of tag.
 *
 * - `no-comment-empty-line`: the close delimiter of a comment tag written `-%>`;
 * - `slurp-newline`: a line break before a slurp tag;
 * - `prefer-slurping-codeonly`: a code tag written `<%_ … _%>`, its code trimmed;
 * - `indent`: the line of a tag on a line of its own, from its start, at the indentation of its depth (see
 *   `normalizeContent`);
 * - `prefer-single-line-tags`: a tag of several statements split, a tag a statement (see `indentSplitTags`).
 *
 * The fixes of the slurp tags and of the comment tags change the blanks and the line breaks the template renders:
 * what the conventions are about. The fixes of `indent` and `prefer-single-line-tags` keep what it renders.
 *
 * The text of a fix is not stable: the range it replaces and how it writes the tags may change from one version to
 * another, in a minor or a patch release too. What it does is kept: it resolves the diagnostic, keeping what the
 * template renders where it does.
 */
export function fixOf(
  template: EjsTemplate,
  diagnostic: Pick<EjsDiagnostic, 'code' | 'offset'>,
  options: EjsFixOptions = {},
): EjsFix | undefined {
  liveTemplate(template, 'fixOf');
  const tag = template.tags.find(({ offset }) => offset === diagnostic.offset);
  if (!tag) return undefined;
  if (tag.type === 'comment') {
    if (diagnostic.code !== 'no-comment-empty-line') return undefined;
    const { length } = tag.closeDelim;
    return { offset: tag.offset + tag.length - length, length, text: '-%>' };
  }
  const source = template.text.slice(tag.offset, tag.offset + tag.length);
  const lineStart = tag.offset - tag.column;
  switch (diagnostic.code) {
    case 'slurp-newline':
      return { offset: tag.offset, length: 0, text: '\n' };
    case 'prefer-slurping-codeonly':
      return { offset: tag.offset, length: tag.length, text: `<%_ ${tag.code.trim()} _%>` };
    case 'indent': {
      const text = indentedTag(
        tag,
        options.normalizeContent ?? false,
        options.binaryOperands ?? 'greater',
        options.indentTag ?? true,
      );
      return text === tag.linePrefix + source
        ? undefined
        : { offset: lineStart, length: tag.column + tag.length, text };
    }
    case 'prefer-single-line-tags': {
      const indentSplitTags = options.indentSplitTags ?? false;
      const offset = indentSplitTags && tag.isStandalone ? lineStart : tag.offset;
      return { offset, length: tag.offset + tag.length - offset, text: splitTags(tag, indentSplitTags) };
    }
    default:
      return undefined;
  }
}
