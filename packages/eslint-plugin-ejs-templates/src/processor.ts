// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Linter, Rule } from 'eslint';
import createDebug from 'debug';
import {
  buildTemplate,
  cleanupTemplate,
  type EjsBlock,
  type EjsCodeTag,
  type EjsDiagnostic,
  type EjsDiagnosticCode,
  type EjsEdit,
  type EjsTemplate,
  type EjsTemplateNode,
  type EjsText,
  editTemplate,
  type RelativeJavascriptNode,
  type SyntaxNode,
  validateTemplate,
} from 'ejs-template-parser';
import { EJS_MARKER_PREFIX, extractTagBlocks, type TagBlock } from './ejs-parser.js';
import { ifOpening, tokensAre, tokensOf, type VirtualMarkerComment } from './utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Indentation unit used by the ejsIndent brace-depth algorithm (2 spaces). */
const debug = createDebug('ejs-templates:processor');

// ---------------------------------------------------------------------------
// Slurping eligibility check
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Function-wrapper helpers
// ---------------------------------------------------------------------------

/**
 * Sentinel text written by the `experimental-prefer-slurp-multiline` fix.
 * Using a non-empty distinct value lets `translateFix` tell this sentinel
 * apart from the generic `''` sentinel used by all other plugin rules.
 */
export const SENTINEL_PREFER_SLURP_MULTILINE = 'PREFER_SLURP_MULTILINE';

/**
 * Sentinel text written by `prefer-single-line-tags`.
 */
export const SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES = 'PREFER_SINGLE_LINE_TAGS_BRACES';
/**
 * Sentinel text written by the `slurp-newline` fix.
 */
export const SENTINEL_SLURP_NEWLINE = 'SLURP_NEWLINE';

/**
 * Sentinel text written by the `indent` fix.
 */
export const SENTINEL_INDENT = 'INDENT';

/**
 * Sentinel text written by the `indent` fix when `normalizeContent` is enabled.
 */
export const SENTINEL_INDENT_NORMALIZE = 'INDENT_NORMALIZE';

/**
 * Sentinel text written by the `format` fix.
 */
export const SENTINEL_FORMAT = 'FORMAT';

/**
 * Sentinel text written by the `format` fix when `multilineCloseOnNewLine`
 * is enabled.
 */
export const SENTINEL_FORMAT_MULTILINE_CLOSE = 'FORMAT_MULTILINE_CLOSE';

/**
 * Sentinel text written by the `no-comment-empty-line` fix.
 */
export const SENTINEL_COMMENT_EMPTY_LINE = 'COMMENT_EMPTY_LINE';

/**
 * Sentinel text written by the `output-semi` fix when `always` is enabled.
 * Inserts `;` at the end of the output tag content (before `%>`).
 */
export const SENTINEL_OUTPUT_SEMI_ADD = 'OUTPUT_SEMI_ADD';

/**
 * Sentinel text written by the `output-semi` fix when `never` is enabled.
 * Removes the trailing `;` from the output tag content.
 */
export const SENTINEL_OUTPUT_SEMI_REMOVE = 'OUTPUT_SEMI_REMOVE';

/**
 * Sentinel text written by the `prefer-output` fix.
 */
export const SENTINEL_PREFER_OUTPUT = 'PREFER_OUTPUT';
export const SENTINEL_PREFER_OUTPUT_ELSE = 'PREFER_OUTPUT_ELSE';
export const SENTINEL_NO_MULTILINE_OUTPUT = 'NO_MULTILINE_OUTPUT';

/** Opening line of the function wrapper injected around the full virtual file. */
const GLOBAL_VIRTUAL_OPEN = '(function() {\n';
/** Closing line of the function wrapper injected around the full virtual file. */
const GLOBAL_VIRTUAL_CLOSE = '\n})();';

// ---------------------------------------------------------------------------
// Message position mapping
// ---------------------------------------------------------------------------

/**
 * Map an ESLint message from the virtual JS file back to the original EJS file.
 *
 * Virtual file structure per block:
 * ```
 * Line 1:   //@ejs-tag:<type>                ← type marker comment
 * Line 2:   <first JS>[virtualBodyInlineSuffix]
 *           ← block.originalLine
 * Line 2+n: <further JS lines>               ← block.originalLine + n
 * Line 2+m: [virtualBodyExtraLine]            ← filtered out (maps to tag position)
 * ```
 */
/**
 * Whether a message points at the synthetic `;` appended to an output tag's expression.
 *
 * That character exists only to make the virtual JavaScript a statement; it is not in the
 * template, so a rule reporting on it is reporting on generated code. Messages from this
 * plugin's own rules and ESLint's system messages are left alone.
 */
function isSyntheticSuffixMessage(msg: Linter.LintMessage, segment: VirtualBlockSegment): boolean {
  const { block } = segment;
  if (block.virtualBodyInlineSuffix.length === 0) {
    return false;
  }
  if (msg.ruleId === null || msg.ruleId.startsWith('ejs-templates/')) {
    return false;
  }

  // The suffix sits at the end of the last line of the tag's content, which is the line after
  // the marker comment plus however many lines that content spans.
  const codeLines = block.lintCodeContent.split('\n');
  const suffixLine = segment.startLine + codeLines.length;
  const suffixColumn = (codeLines.at(-1)?.length ?? 0) + 1;

  return msg.line === suffixLine && msg.column >= suffixColumn;
}

/** The range of the tag of a block in the template, in 1-based columns as ESLint's. */
const tagRangeOf = (block: TagBlock, sourceText: string) =>
  rangeOf(
    { offset: block.tagOffset, length: block.tagLength, line: block.tagLine, column: block.tagColumn },
    sourceText,
  );

/**
 * Where a position of the virtual code of a block is in the template, its line counted in the block, the marker comment
 * the first: a position in the code of the tag, where its character is; on the marker, before the code, the start of the
 * tag; past the code (the lines the processor adds, the wrapper), the end of the tag for the end of a range, its start
 * otherwise.
 */
function mapPosition(
  block: TagBlock,
  sourceText: string,
  position: { line: number; column: number },
  edge: 'start' | 'end',
): { line: number; column: number } {
  // Line 1 is the marker comment; code starts on line 2.
  const codeLineIndex = position.line - 2;
  // How many lines does codeContent occupy?  A trailing '\n' does not add an
  // extra logical line — it just means the next character (the wrapper close
  // or synthetic suffix) starts on a new line.
  const codeLineCount = block.codeContent.split('\n').length - (block.codeContent.endsWith('\n') ? 1 : 0);
  if (codeLineIndex >= 0 && codeLineIndex < codeLineCount) {
    return {
      line: block.originalLine + codeLineIndex,
      column: codeLineIndex === 0 ? position.column + block.originalColumn : position.column,
    };
  }
  const tag = tagRangeOf(block, sourceText);
  return codeLineIndex >= 0 && edge === 'end'
    ? { line: tag.endLine, column: tag.endColumn }
    : { line: tag.line, column: tag.column };
}

/**
 * A message of the virtual code in the template, its lines counted in the block it starts in, and for its end in
 * `endBlock`, the block it ends in: a later one for a node across tags. A message on the marker of a tag alone, as the
 * rules of the conventions report, covers the tag.
 */
function mapMessage(
  msg: Linter.LintMessage,
  block: TagBlock,
  sourceText: string,
  endBlock: TagBlock = block,
): Linter.LintMessage {
  if (msg.line < 2 && endBlock === block && (msg.endLine ?? 1) < 2) {
    const tag = tagRangeOf(block, sourceText);
    return msg.endLine === undefined ? { ...msg, line: tag.line, column: tag.column } : { ...msg, ...tag };
  }
  const mapped: Linter.LintMessage = { ...msg, ...mapPosition(block, sourceText, msg, 'start') };
  if (msg.endLine !== undefined) {
    const end = mapPosition(endBlock, sourceText, { line: msg.endLine, column: msg.endColumn ?? 1 }, 'end');
    mapped.endLine = end.line;
    mapped.endColumn = end.column;
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Fix translation
// ---------------------------------------------------------------------------

/**
 * Build the collapsed replacement text for a multiline EJS tag.
 *
 * Algorithm:
 * 1. Split content into trimmed non-empty lines.
 * 2. Accumulate lines, joining them with a space (or no space for `.` continuation).
 * 3. Emit a new tag whenever the accumulated content ends with `;`, `}` or `{`.
 *    Lines that do NOT end with one of those characters are folded into the next
 *    line (continuation).  Any remaining accumulated content after the last
 *    statement-terminator is emitted as a final tag.
 *
 * Examples:
 * ```
 * if (x) {\n  doWork();\n}
 * ```
 * → `<%_ if (x) { _%>`, `<%_ doWork(); _%>`, `<%_ } _%>`
 *
 * ```
 * const arr = 'foo'\n  .split();\n const y = 2;
 * ```
 * → `<%_ const arr = 'foo'.split(); _%>`, `<%_ const y = 2; _%>`  (dot-continuation joined)
 *
 * The tag is one `prefer-single-line-tags` reports, of several statements (`splitStatements()`), which split at the
 * braces of its blocks alone: one tag a statement, never the tag itself.
 */
function buildCollapsedTag(
  block: TagBlock,
  javascriptPartialNode: RelativeJavascriptNode,
  applyIndent: boolean,
): string {
  const tags = javascriptPartialNode.splitStatements();

  // An inline tag has template text either side of it, so the tags it splits into stay adjacent
  // on the same line and keep the original delimiters. Putting each on its own line would insert
  // a line break that only slurp delimiters could take back out, which would mean rewriting
  // delimiters the author chose; leaving the tags adjacent introduces nothing to undo.
  if (!block.isStandalone) {
    // The author's opening delimiter belongs on the first tag only: repeating `<%_` on each one
    // would ask for the whitespace before the tag to be slurped once per generated tag rather
    // than once. Later tags open with whatever pairs with the closing delimiter, so the seams
    // stay in the delimiter family the tag already uses and cannot let whitespace creep in.
    const seamOpenDelim = block.closeDelim === '_%>' ? '<%_' : '<%';
    return tags
      .map((tag, index) => `${index === 0 ? block.openDelim : seamOpenDelim} ${tag.trim()} ${block.closeDelim}`)
      .join('');
  }

  if (!applyIndent) {
    // Legacy prefer-single-line-tags behaviour: preserve existing indentation.
    return tags
      .map((tag, i) => {
        const isFirst = i === 0;
        const isLast = i === tags.length - 1;
        const openDelim = isFirst ? block.openDelim : '<%_';
        const closeDelim = isLast ? block.closeDelim : '_%>';
        const prefix = i === 0 ? '' : block.lineIndent;
        return `${prefix}${openDelim} ${tag} ${closeDelim}`;
      })
      .join('\n');
  }

  // Indent-aware split: align generated tags with expected indent and structural depth.
  const resultParts: string[] = [];
  let relativeDepth = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const isFirst = i === 0;
    const isLast = i === tags.length - 1;
    const openDelim = isFirst ? block.openDelim : '<%_';
    const closeDelim = isLast ? block.closeDelim : '_%>';
    const trimmedTag = tag.trim();

    if (!isFirst && trimmedTag.startsWith('}')) {
      relativeDepth = Math.max(0, relativeDepth - 1);
    }

    const prefix = block.expectedIndent + '  '.repeat(relativeDepth);
    resultParts.push(`${prefix}${openDelim} ${trimmedTag} ${closeDelim}`);

    if (trimmedTag.endsWith('{')) {
      relativeDepth++;
    }
  }
  return resultParts.join('\n');
}

function buildIndentedTag(block: TagBlock, options: { normalizeContent: boolean }): string {
  const normalizeContent = options.normalizeContent;
  const tagText = `${block.openDelim}${block.codeContent}${block.closeDelim}`;

  if (!tagText.includes('\n')) {
    return `${block.expectedIndent}${tagText}`;
  }

  // Multiline tag: trim content start, indent content lines to align with
  // the position after the opening delimiter and space:
  // contentIndent = expectedIndent + openDelim.length + 1 (for space)
  const content = block.codeContent.trim();
  const contentLines = content.split('\n');
  const normalizedContentIndent = ' '.repeat(block.expectedIndent.length + block.openDelim.length + 1);

  const lines: string[] = [];

  // First line: opening delimiter + first content line (with space)
  const firstLine = contentLines[0].trimStart();
  lines.push(`${block.expectedIndent}${block.openDelim} ${firstLine}`);

  const isOpenBlock = (line: string) =>
    line.endsWith('{') || line.endsWith('(') || line.endsWith('[') || line.endsWith('=>');
  const isCloseBlock = (line: string) => line.startsWith('}') || line.startsWith(')') || line.startsWith(']');
  const isContinueStatement = (line: string) => /^[=?:|&><]/.test(line) || /^\.[^.]/.test(line);
  let relativeBlockIndent = isOpenBlock(firstLine) ? 1 : 0;
  const relativeStatementIndentStack: number[] = [];
  // Middle lines:
  // - normalizeContent=true  -> normalize each line to content-level indentation
  // - normalizeContent=false -> preserve internal line indentation
  for (let i = 1; i < contentLines.length; i++) {
    if (normalizeContent) {
      const trimmedLine = contentLines[i].trimStart();
      const relativeStatementIndent = isContinueStatement(trimmedLine) ? 1 : 0;

      if (isCloseBlock(trimmedLine)) {
        relativeBlockIndent = Math.max(0, relativeBlockIndent - 1);
      }
      lines.push(
        `${normalizedContentIndent}${'  '.repeat(relativeBlockIndent + relativeStatementIndent + (relativeStatementIndentStack.at(-1) ?? 0))}${trimmedLine}`.trimEnd(),
      );
      if (isCloseBlock(trimmedLine)) {
        relativeStatementIndentStack.pop();
      }
      if (isOpenBlock(trimmedLine)) {
        relativeStatementIndentStack.push(relativeStatementIndent);
        relativeBlockIndent++;
      }
    } else {
      lines.push(contentLines[i]);
    }
  }

  // Last line: closing delimiter with same indent as opening tag
  lines.push(`${block.expectedIndent}${block.closeDelim}`);

  return lines.join('\n');
}

function buildFormattedTag(block: TagBlock, options: { multilineCloseOnNewLine: boolean }): string {
  const { multilineCloseOnNewLine } = options;
  const trimmedContent = block.codeContent.trim();
  const wasMultiline = block.codeContent.includes('\n');

  if (trimmedContent.length === 0) {
    return `${block.openDelim} ${block.closeDelim}`;
  }

  if (!multilineCloseOnNewLine || !wasMultiline) {
    return `${block.openDelim} ${trimmedContent} ${block.closeDelim}`;
  }

  const split = trimmedContent.split('\n').map((line) => line.trimEnd());
  const lines = split.join('\n');

  if (block.closeDelim === '%>' || split.length === 1) {
    return `${block.openDelim} ${lines} ${block.closeDelim}`;
  }

  return `${block.openDelim} ${lines}\n${block.lineIndent}${block.closeDelim}`;
}

/** Escape sequences a single- or double-quoted literal may contain and still be decodable. */
const STRING_ESCAPES = new Map<string, string>([
  ['\\n', '\n'],
  ['\\r', '\r'],
  ['\\t', '\t'],
  ["\\'", "'"],
  ['\\"', '"'],
  ['\\\\', '\\'],
]);

/**
 * Text a quoted string literal evaluates to, or null when it is not a plain decodable literal.
 *
 * Decoded from the parse tree's own `string_fragment` / `escape_sequence` children rather than
 * by unescaping the raw text, so an escape this code does not understand causes a bail-out
 * instead of a wrong result. Template literals are rejected: they can interpolate.
 */
function decodeStringLiteral(node: SyntaxNode): string | null {
  if (node.type !== 'string') {
    return null;
  }
  let decoded = '';
  for (const child of node.children) {
    if (child.type === 'string_fragment') {
      decoded += child.text;
    } else if (child.type === 'escape_sequence') {
      const value = STRING_ESCAPES.get(child.text);
      if (value === undefined) {
        return null;
      }
      decoded += value;
    } else if (child.type !== "'" && child.type !== '"') {
      return null;
    }
  }
  return decoded;
}

/** An output ternary whose branches are literals and whose rendered text spans lines. */
export type MultilineOutputConditionalParts = {
  condition: string;
  consequent: string;
  alternate: string;
};

/**
 * Extract the parts of an output tag of the form `<%- cond ? 'a\nb' : '' %>`.
 *
 * Returns null unless the tag is a single-line output tag holding one ternary whose branches
 * are both plain string literals and whose rendered output actually contains a newline — the
 * case where a conditional block reads better than an escaped one-liner.
 */
export function getMultilineOutputConditionalParts(block: TagBlock): MultilineOutputConditionalParts | null {
  if (block.tagType !== 'escaped-output' && block.tagType !== 'raw-output') {
    return null;
  }

  const partialNode = block.javascriptPartialNode;
  if (!partialNode || partialNode.multilineOriginal) {
    return null;
  }

  // A ternary whose strings render a line break has a `?` and an escaped `\n`: the tree of any other code is not read,
  // which ejs-template-parser parses only when it is.
  if (!block.codeContent.includes('?') || !block.codeContent.includes('\\n')) {
    return null;
  }

  const conditionalNode = partialNode.nodes.find(
    (node) => node.type === 'ternary_expression' && node.parent?.type === 'expression_statement',
  );
  if (!conditionalNode) {
    return null;
  }

  const conditionNode = conditionalNode.childForFieldName('condition');
  const consequentNode = conditionalNode.childForFieldName('consequence');
  const alternateNode = conditionalNode.childForFieldName('alternative');
  if (!conditionNode || !consequentNode || !alternateNode) {
    return null;
  }

  const consequent = decodeStringLiteral(consequentNode);
  const alternate = decodeStringLiteral(alternateNode);
  const condition = conditionNode.text.trim();
  if (consequent === null || alternate === null || condition.length === 0) {
    return null;
  }

  // Only the multiline case: a single-line ternary is already the more readable form, and is
  // what `prefer-output` deliberately produces.
  if (!consequent.includes('\n') && !alternate.includes('\n')) {
    return null;
  }

  return { condition, consequent, alternate };
}

/** Unwrap one layer of parentheses, so `(a && b)` yields `a && b`. */
function unwrapParentheses(node: SyntaxNode): SyntaxNode {
  if (node.type !== 'parenthesized_expression') {
    return node;
  }
  return node.childForFieldName('expression') ?? node.namedChildren.at(0) ?? node;
}

/**
 * Positive form of a negated `if` test, or null when the test is not negated.
 *
 * Mirrors what the core `no-negated-condition` rule treats as negated: a `!` unary and the
 * `!==` / `!=` binaries. Inverting the operator (rather than wrapping the whole test in
 * another `!`) is what lets the fix read as if it had been written that way by hand.
 */
function invertNegatedTest(conditionNode: SyntaxNode): string | null {
  const test = unwrapParentheses(conditionNode);

  if (test.type === 'unary_expression' && test.text.trimStart().startsWith('!')) {
    const argument = test.childForFieldName('argument') ?? test.namedChildren.at(0) ?? null;
    if (!argument) {
      return null;
    }
    // `!(a && b)` becomes `a && b` rather than `(a && b)`: the `if (…)` already
    // supplies the parentheses, so keeping them would double them up.
    const positive = unwrapParentheses(argument).text.trim();
    return positive.length > 0 ? positive : null;
  }

  if (test.type === 'binary_expression') {
    const left = test.child(0);
    const operator = test.child(1);
    const right = test.child(2);
    if (!left || !operator || !right) {
      return null;
    }
    const positiveOperator = operator.type === '!==' ? '===' : operator.type === '!=' ? '==' : null;
    if (!positiveOperator) {
      return null;
    }
    return `${left.text.trim()} ${positiveOperator} ${right.text.trim()}`;
  }

  return null;
}

/**
 * Positive condition for a tag holding exactly `if (<negated test>) {`, or null.
 *
 * Only the opening tag is inspected here; whether the statement actually has an `else`
 * branch to swap with is decided by the caller from the surrounding blocks.
 */
export function getNegatedIfCondition(block: TagBlock): string | null {
  const javascript = block.javascriptPartialNode;
  if (!javascript || javascript.multilineOriginal) {
    return null;
  }
  const conditionNode = ifOpening(tokensOf(javascript), 0)?.childForFieldName('condition');
  return conditionNode ? invertNegatedTest(conditionNode) : null;
}

/** Whether the code of a tag is exactly `} else {`, a comment aside — an `else if` continuation deliberately does not match. */
function isElseOpening(javascript: RelativeJavascriptNode): boolean {
  return tokensAre(tokensOf(javascript, { comments: false }), '}', 'else', '{');
}

/** Positive form of a negated `} else if (…) {` link's test, or null when it is not one. */
export function getNegatedElseIfCondition(block: TagBlock): string | null {
  const javascript = block.javascriptPartialNode;
  if (!javascript || javascript.multilineOriginal) {
    return null;
  }
  const tokens = tokensOf(javascript);
  if (!tokensAre(tokens.slice(0, 2), '}', 'else')) {
    return null;
  }
  const conditionNode = ifOpening(tokens, 2)?.childForFieldName('condition');
  return conditionNode ? invertNegatedTest(conditionNode) : null;
}

/** Whether the code of a tag is exactly `}`, a comment aside, closing a block without opening another. */
function isBlockClosing(javascript: RelativeJavascriptNode): boolean {
  return tokensAre(tokensOf(javascript, { comments: false }), '}');
}

/**
 * The block of the tree of a template a tag opens a branch of, with the index of that branch: the `if` of a block
 * is its branch 0, each `} else if (…) {` and `} else {` the next one. A tag opening several blocks opens a branch of
 * the outer one.
 */
function findBranch(children: EjsTemplateNode[], offset: number): { block: EjsBlock; index: number } | null {
  for (const node of children) {
    if (node.kind !== 'block') continue;
    const index = node.branches.findIndex((branch) => branch.open.offset === offset);
    if (index !== -1) return { block: node, index };
    for (const branch of node.branches) {
      const found = findBranch(branch.children, offset);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The `} else {` and closing `}` tags of the `if` (or `} else if (…) {` link) a tag opens, from the tree of the
 * template: its branch is followed by a plain `} else {` branch, the last one, and the block closes with a plain `}`.
 *
 * Returns null when the statement has no `else`, when the next branch is an `else if` link (the chain cannot be
 * swapped past it), or when the template ends with the block open.
 */
export function findNegatedConditionBranches(
  template: EjsTemplate,
  block: TagBlock,
): { elseTag: EjsCodeTag; closeTag: EjsCodeTag } | null {
  const found = findBranch(template.children, block.tagOffset);
  if (!found) return null;
  const { branches, close } = found.block;
  const elseBranch = branches.at(found.index + 1);
  if (!elseBranch || found.index + 2 !== branches.length || !close) return null;
  if (!isElseOpening(elseBranch.open.javascript) || !isBlockClosing(close.javascript)) return null;
  return { elseTag: elseBranch.open, closeTag: close };
}

/** Output tag types, including the multiline variants. */
const OUTPUT_TAG_TYPES = new Set<string>([
  'escaped-output',
  'raw-output',
  'escaped-output-multiline',
  'raw-output-multiline',
]);

/** Whether a tag renders a value, regardless of whether its content spans lines. */
export const isOutputTagType = (tagType: string): boolean => OUTPUT_TAG_TYPES.has(tagType);

/** The characters `<%=` escapes, as EJS escapes them (`escapeXML`). */
const HTML_ESCAPED = /[&<>'"]/u;

/**
 * What EJS renders of the children of a branch, from the `rendered` of its texts: null when a tag other than a
 * comment, or a block, is among them, which renders no text of its own.
 */
function renderedOf(children: EjsTemplateNode[]): string | null {
  let rendered = '';
  for (const node of children) {
    if (node.kind === 'text') {
      rendered += node.rendered;
    } else if (node.kind === 'block' || node.type !== 'comment') {
      return null;
    }
  }
  return rendered;
}

/** The errors of ejs-template-parser which the JavaScript of a template does not parse by. */
const JAVASCRIPT_ERRORS = new Set<EjsDiagnosticCode>(['javascript-error', 'unclosed-block', 'unopened-close']);

/** Rule id of the built-in ESLint rule this plugin supplies an autofix for. */
const CORE_NO_NEGATED_CONDITION = 'no-negated-condition';

/** Source offset of a 1-based line and 1-based column. */
function offsetOfPosition(sourceText: string, line: number, column: number): number {
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine++) {
    const lineBreak = sourceText.indexOf('\n', offset);
    if (lineBreak === -1) {
      return sourceText.length;
    }
    offset = lineBreak + 1;
  }
  return offset + column - 1;
}

/**
 * Rewrite a negated ternary in place: `!c ? a : b` => `c ? b : a`.
 *
 * The ternary's own source range is replaced rather than the surrounding tag, so this works
 * wherever the expression sits — the whole content of an output tag, a nested
 * `${…}` inside a template literal, or an assignment inside a code tag. Nothing outside the
 * expression is touched, so delimiters, spacing and any trailing semicolon survive untouched.
 *
 * `targetOffset` is the source offset the rule reported at; a tag may hold several ternaries,
 * and only the reported one should be rewritten.
 */
function buildNegatedTernaryFix(
  block: TagBlock,
  targetOffset: number | undefined,
): { range: [number, number]; text: string } | null {
  const partialNode = block.javascriptPartialNode;
  if (!partialNode) {
    return null;
  }

  const contentStart = block.tagOffset + block.openDelim.length;
  let best: { range: [number, number]; text: string; size: number } | null = null;

  for (const node of partialNode.nodes) {
    if (node.type !== 'ternary_expression') {
      continue;
    }

    const conditionNode = node.childForFieldName('condition');
    const consequentNode = node.childForFieldName('consequence');
    const alternateNode = node.childForFieldName('alternative');
    if (!conditionNode || !consequentNode || !alternateNode) {
      continue;
    }

    const positiveCondition = invertNegatedTest(conditionNode);
    if (!positiveCondition) {
      continue;
    }

    const start = contentStart + (node.startIndex - partialNode.start);
    const end = start + (node.endIndex - node.startIndex);
    if (targetOffset !== undefined && (targetOffset < start || targetOffset >= end)) {
      continue;
    }

    // Ternaries nest, so prefer the smallest one covering the reported position — that is the
    // expression the rule actually reported on.
    const size = end - start;
    if (best && best.size <= size) {
      continue;
    }
    best = {
      range: [start, end],
      text: `${positiveCondition} ? ${alternateNode.text.trim()} : ${consequentNode.text.trim()}`,
      size,
    };
  }

  return best ? { range: best.range, text: best.text } : null;
}

/**
 * Build the EJS source edit that resolves a core `no-negated-condition` report.
 *
 * ```
 * <% if (!c) { %>A<% } else { %>B<% } %>  =>  <% if (c) { %>B<% } else { %>A<% } %>
 * ```
 *
 * The core rule reports this correctly in EJS templates — the virtual JavaScript keeps the
 * `if`/`else` structure intact — but cannot fix it, because the branch bodies are template
 * markup sitting between tags, outside the JavaScript it sees. Rather than duplicating the
 * rule, the processor attaches this fix to the core rule's own report.
 *
 * Handles both forms the core rule reports in EJS: a negated `if`/`else` pair spanning tags,
 * and a negated ternary inside a single output tag. Returns null for anything else.
 */
function buildNegatedConditionFix(
  block: TagBlock,
  template: EjsTemplate,
  sourceText: string,
  targetOffset?: number,
): { range: [number, number]; text: string } | null {
  // Either an `if` tag or an `} else if (…) {` link. Swapping a link's own two branches keeps
  // the chain around it intact — the outer `if` and the closing tag are never touched — and the
  // core rule only reports a link whose own `else` is a plain block, which is exactly the shape
  // the branch matcher looks for.
  const ifCondition = getNegatedIfCondition(block);
  const elseIfCondition = ifCondition === null ? getNegatedElseIfCondition(block) : null;
  const positiveCondition = ifCondition ?? elseIfCondition;
  const branches = positiveCondition === null ? null : findNegatedConditionBranches(template, block);
  if (positiveCondition === null || !branches) {
    // Not an `if`/`else` pair; the other form the core rule reports is a negated ternary.
    return buildNegatedTernaryFix(block, targetOffset);
  }

  const { elseTag: elseNode, closeTag: closeNode } = branches;
  const ifTagEnd = block.tagOffset + block.tagLength;
  const elseTagStart = elseNode.offset;
  const elseTagEnd = elseNode.offset + elseNode.length;
  const closeTagStart = closeNode.offset;
  const closeTagEnd = closeNode.offset + closeNode.length;

  // Branch bodies are carried over verbatim, so template markup and indentation survive the swap
  // untouched. What a body renders depends on the delimiters around it as well: the close
  // delimiter of the tag before it (the line break a `-%>` drops, the blanks a `_%>` slurps)
  // and the open delimiter of the tag after it (the blanks a `<%_` slurps). They move with it:
  // each body keeps its neighbours, and the delimiters out of the statement stay as they are.
  const consequentBody = sourceText.slice(ifTagEnd, elseTagStart);
  const alternateBody = sourceText.slice(elseTagEnd, closeTagStart);
  const elseTag = `${closeNode.openDelim}${elseNode.code}${block.closeDelim}`;
  const closeTag = `${elseNode.openDelim}${closeNode.code}${closeNode.closeDelim}`;
  const openingTag =
    elseIfCondition === null
      ? `${block.openDelim} if (${positiveCondition}) { ${elseNode.closeDelim}`
      : `${block.openDelim} } else if (${positiveCondition}) { ${elseNode.closeDelim}`;

  return {
    range: [block.tagOffset, closeTagEnd],
    text: `${openingTag}${alternateBody}${elseTag}${consequentBody}${closeTag}`,
  };
}

/**
 * Translate an ESLint fix object from the virtual JS code space back to the
 * original EJS source space.
 *
 * Three fix kinds are supported:
 *
 * **Sentinel fixes** (from plugin rules): the plugin rules report a fix that
 * replaces the virtual marker comment (`//@ejs-tag:<type>`) with either an
 * empty string or a rule-specific sentinel text.  Those fixes always start at
 * offset 0.  They are translated using the `TagBlock` metadata to produce a
 * meaningful replacement in the original EJS source.
 *
 * - Generic sentinel (`text === ''`): used by `prefer-encoded`, `prefer-slurping-codeonly`,
 *   `prefer-single-line-tags`, `indent`.
 * - `SENTINEL_PREFER_SLURP_MULTILINE`: used by `experimental-prefer-slurp-multiline` to avoid
 *   collision with `prefer-single-line-tags` for `code-multiline`/`code-slurpable-multiline`
 *   tag types.
 * - `SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES`: used by
 *   `prefer-single-line-tags`.
 * - `SENTINEL_SLURP_NEWLINE`: used by `slurp-newline`.
 *
 * **General JS fixes** (from standard ESLint rules such as `no-var`,
 * `prefer-const`, etc.): the fix offsets are positions within the virtual
 * code's `codeContent` portion.  They are translated by mapping the virtual
 * code offsets back to the corresponding positions in the original EJS source:
 *
 * ```
 * codeContentStart = markerLen
 * originalOffset   = tagOffset + openDelim.length + (virtualOffset - codeContentStart)
 * ```
 */
function translateFix(
  fix: { range: [number, number]; text: string },
  block: TagBlock,
  options: {
    applyIndentForSingleLineTags: boolean;
    /** The template, for the fixes spanning several tags: its blocks, and what EJS renders of its texts. */
    template: EjsTemplate;
    /** The diagnostics of the template, the conventions its tags break, which the rules reporting them fix. */
    diagnostics: EjsDiagnostic[];
  },
): { range: [number, number]; text: string } | null {
  /** Whether ejs-template-parser diagnoses the tag of the block with a code. */
  const diagnosed = (code: EjsDiagnosticCode): boolean =>
    options.diagnostics.some((diagnostic) => diagnostic.code === code && diagnostic.offset === block.tagOffset);
  // no-comment-empty-line sentinel: handled before the javascriptPartialNode guard
  // because comment-empty-line blocks have no javascriptPartialNode.
  if (fix.range[0] === 0 && fix.text === SENTINEL_COMMENT_EMPTY_LINE) {
    if (block.tagType === 'comment-empty-line') {
      const closeLen = block.closeDelim.length;
      return {
        range: [block.tagOffset + block.tagLength - closeLen, block.tagOffset + block.tagLength],
        text: '-%>',
      };
    }
    return null;
  }

  const { applyIndentForSingleLineTags } = options;
  const trimmedCodeContent = block.codeContent.trim();
  // ── Sentinel fix detection ─────────────────────────────────────────────
  // All plugin-rule sentinels start at offset 0 in the virtual file.
  if (fix.range[0] !== 0) {
    // Fall through to the general JS fix handler below.
  } else if (fix.text === SENTINEL_PREFER_SLURP_MULTILINE) {
    // experimental-prefer-slurp-multiline: change multiline `<% … %>` → `<%_ … _%>` (content unchanged)
    if (block.tagType === 'code-multiline' || block.tagType === 'code-slurpable-multiline') {
      return {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: `<%_ ${trimmedCodeContent} _%>`,
      };
    }
    return null;
  } else if (fix.text === SENTINEL_SLURP_NEWLINE) {
    // slurp-newline: insert a newline before a non-standalone slurp tag
    if (diagnosed('slurp-newline')) {
      return {
        range: [block.tagOffset, block.tagOffset],
        text: '\n',
      };
    }
    return null;
  } else if (fix.text === SENTINEL_INDENT) {
    // indent: fix standalone <%_ _%> indentation (single-line and multiline). The fix replaces
    // from the start of the line, which a tag the parser diagnoses is alone on.
    if (diagnosed('indent')) {
      // Replace from line start through full tag; in default mode only the
      // start/end boundaries are adjusted for multiline content.
      const indentStart = block.tagOffset - block.tagColumn;
      return {
        range: [indentStart, block.tagOffset + block.tagLength],
        text: buildIndentedTag(block, { normalizeContent: false }),
      };
    }
    return null;
  } else if (fix.text === SENTINEL_INDENT_NORMALIZE) {
    // indent (normalizeContent=true): normalize multiline content indentation too.
    if (block.isStandalone && (diagnosed('indent') || block.tagType === 'slurp-multiline')) {
      const indentStart = block.tagOffset - block.tagColumn;
      const normalizedText = buildIndentedTag(block, { normalizeContent: true });
      const currentText = block.lineIndent + block.openDelim + block.codeContent + block.closeDelim;
      if (normalizedText === currentText) {
        return null;
      }
      return {
        range: [indentStart, block.tagOffset + block.tagLength],
        text: normalizedText,
      };
    }
    return null;
  } else if (fix.text === SENTINEL_FORMAT || fix.text === SENTINEL_FORMAT_MULTILINE_CLOSE) {
    const multilineCloseOnNewLine = fix.text === SENTINEL_FORMAT_MULTILINE_CLOSE;
    const originalText = block.openDelim + block.codeContent + block.closeDelim;
    const fixedText = buildFormattedTag(block, { multilineCloseOnNewLine });
    if (fixedText === originalText) {
      return null;
    }
    return {
      range: [block.tagOffset, block.tagOffset + block.tagLength],
      text: fixedText,
    };
  } else if (fix.text === SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES) {
    // prefer-single-line-tags: collapse a multiline tag while keeping content between braces in
    // a single tag, and split a single-line tag that carries more than one brace boundary, a tag
    // the parser diagnoses. `buildCollapsedTag` produces one tag per boundary either way.
    const { javascriptPartialNode } = block;
    if (!javascriptPartialNode || !diagnosed('prefer-single-line-tags')) return null;
    const fixedText = buildCollapsedTag(block, javascriptPartialNode, applyIndentForSingleLineTags);
    const bracesModeIndentStart =
      applyIndentForSingleLineTags && block.isStandalone ? block.tagOffset - block.tagColumn : block.tagOffset;
    return {
      range: [bracesModeIndentStart, block.tagOffset + block.tagLength],
      text: fixedText,
    };
  } else if (fix.text === SENTINEL_OUTPUT_SEMI_ADD) {
    // output-semi (always): insert `;` at the end of the trimmed code content
    if (isOutputTagType(block.tagType)) {
      const insertPos = block.tagOffset + block.openDelim.length + block.codeContent.trimEnd().length;
      return { range: [insertPos, insertPos], text: ';' };
    }
    return null;
  } else if (fix.text === SENTINEL_OUTPUT_SEMI_REMOVE) {
    // output-semi (never): remove the trailing `;` from the code content
    if (isOutputTagType(block.tagType)) {
      const trimmedContent = block.codeContent.trimEnd();
      if (trimmedContent.endsWith(';')) {
        const semiPos = block.tagOffset + block.openDelim.length + trimmedContent.length - 1;
        return { range: [semiPos, semiPos + 1], text: '' };
      }
    }
    return null;
  } else if (fix.text === SENTINEL_PREFER_OUTPUT || fix.text === SENTINEL_PREFER_OUTPUT_ELSE) {
    // prefer-output: convert wrapper conditionals to output ternary:
    // `<% if (cond) { %>a<% } %>` => `<%= cond ? 'a' : '' %>`
    // `<% if (cond) { %>a<% } else { %>b<% } %>` => `<%= cond ? 'a' : 'b' %>`
    // The strings are what EJS renders of the branches, not their source: `%%>` renders `%>`, and the
    // delimiters of the tags slurp blanks and line breaks around them.
    if (block.tagType !== 'code' || block.openDelim !== '<%') {
      return null;
    }

    // The branches of the `if` the tag opens, from the tree of the template, re-checked against what the rule
    // reported: one, or two when the second is a plain `} else {`, and the block closed by a plain `}`.
    const found = findBranch(options.template.children, block.tagOffset);
    const branches = found?.index === 0 ? found.block.branches : [];
    const close = found?.block.close;
    if (
      !close ||
      branches.length !== (fix.text === SENTINEL_PREFER_OUTPUT_ELSE ? 2 : 1) ||
      (branches.length === 2 && !isElseOpening(branches[1].open.javascript)) ||
      !isBlockClosing(close.javascript)
    ) {
      return null;
    }

    const condition = block.javascriptPartialNode?.nodes.find((n) => n.type === 'parenthesized_expression')?.text;
    if (!condition) {
      return null;
    }

    const [truthyContent, falsyContent = ''] = branches.map((branch) => renderedOf(branch.children));

    // Apply only when the full wrapper (tags + outputs) stays on one line.
    if (
      truthyContent === null ||
      falsyContent === null ||
      truthyContent.includes('\n') ||
      falsyContent.includes('\n')
    ) {
      return null;
    }

    // A `<%` or a `%>` in the string would open or close a tag of its own: their `%` and `>` are written escaped.
    const escapeForSingleQuote = (content: string): string => {
      return content
        .replace(/\\/gu, '\\\\')
        .replace(/'/gu, "\\'")
        .replace(/\r/gu, '\\r')
        .replace(/\n/gu, '\\n')
        .replaceAll('<%', '<\\x25')
        .replaceAll('%>', '%\\x3E');
    };

    const escapedTruthyContent = escapeForSingleQuote(truthyContent);
    const escapedFalsyContent = escapeForSingleQuote(falsyContent);
    // `<%=` escapes the HTML of the value, which the text of a branch is not: raw when that would change it. The close
    // delimiter of the last tag stays, with the line break or the blanks it drops after it.
    const openDelim = HTML_ESCAPED.test(truthyContent + falsyContent) ? '<%-' : '<%=';

    return {
      range: [block.tagOffset, close.offset + close.length],
      text: `${openDelim} ${condition} ? '${escapedTruthyContent}' : '${escapedFalsyContent}' ${close.closeDelim}`,
    };
  } else if (fix.text === SENTINEL_NO_MULTILINE_OUTPUT) {
    // no-multiline-output: `<%- cond ? 'a\nb' : '' %>` => a conditional block.
    const parts = getMultilineOutputConditionalParts(block);
    if (!parts) {
      return null;
    }

    // `<%=` escapes its value, whereas the template text the fix produces is emitted raw. The
    // two only agree when the rendered text has nothing to escape, so a `<%=` tag carrying any
    // of EJS's escaped characters is reported without a fix rather than silently changing what
    // the template renders.
    if (block.tagType === 'escaped-output' && /[&<>"']/u.test(parts.consequent + parts.alternate)) {
      return null;
    }

    // Non-slurp tags, with the branch text written flush against them. `<%_`/`_%>` would
    // swallow the surrounding whitespace and newlines, so a slurp block renders differently
    // from the output tag it replaces — it drops the newline the original tag's own line
    // contributes, and drops a leading indent that was literal output. Plain `<% %>` tags emit
    // nothing themselves and consume nothing around them, so writing the text with no added
    // line breaks reproduces the original output exactly, wherever the tag sits. The last tag
    // closes with the delimiter of the output tag, and drops after it what that one dropped:
    // the line break after a `-%>`, the blanks and the line break after a `_%>`.
    const pieces = [`<% if (${parts.condition}) { %>`, parts.consequent];
    if (parts.alternate.length > 0) {
      pieces.push('<% } else { %>', parts.alternate);
    }
    pieces.push(`<% } ${block.closeDelim}`);

    return {
      range: [block.tagOffset, block.tagOffset + block.tagLength],
      text: pieces.join(''),
    };
  } else if (fix.text === '') {
    // ── Generic sentinel (fix.text === '') ────────────────────────────────

    // prefer-encoded (never): change `<%=` → `<%-`
    if (block.tagType === 'escaped-output') {
      return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '-' };
    }

    // prefer-encoded: change `<%-` → `<%=`
    if (block.tagType === 'raw-output') {
      return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '=' };
    }

    // prefer-slurping-codeonly: change `<% … %>` → `<%_ … _%>` (content unchanged)
    if (block.tagType === 'code-slurpable') {
      return {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: `<%_ ${trimmedCodeContent} _%>`,
      };
    }

    return null;
  } else {
    // Not a recognised sentinel; fall through to general JS fix handler.
  }

  if (fix.range[0] === 0 && fix.text !== '') {
    // Non-empty text at range[0]=0 that is not a recognised sentinel – skip.
    return null;
  }

  // ── General JS fix ─────────────────────────────────────────────────────
  // The virtual code body is:
  //   <codeContent><virtualBodyInlineSuffix><virtualBodyExtraLine>
  //
  // codeContent starts at byte offset:
  //   codeContentStart = markerLen
  //
  // where markerLen = '//@ejs-tag:'.length + tagType.length + 1  (+1 for '\n')
  const markerLen = '//'.length + EJS_MARKER_PREFIX.length + block.tagType.length + 1;
  const codeContentStart = markerLen;
  const codeContentEnd = codeContentStart + block.lintCodeContent.length;

  // Guard: only translate fixes that target the actual codeContent region.
  // Allow pure insertions at codeContentEnd so rules like `@stylistic/semi`
  // can insert text immediately before the EJS closing delimiter.
  if (fix.range[0] < codeContentStart || fix.range[0] > codeContentEnd || fix.range[1] > codeContentEnd) {
    return null;
  }

  const codeStartOffset = block.tagOffset + block.openDelim.length;
  return {
    range: [codeStartOffset + (fix.range[0] - codeContentStart), codeStartOffset + (fix.range[1] - codeContentStart)],
    text: fix.text,
  };
}

// ---------------------------------------------------------------------------
// Per-file block map and metadata tracking
// ---------------------------------------------------------------------------

/**
 * Position mapping for a single EJS tag block within the function-wrapped virtual file
 * (`GLOBAL_VIRTUAL_OPEN + blocks + GLOBAL_VIRTUAL_CLOSE`), used for message and fix translation.
 *
 * Line and offset numbers are absolute positions within the virtual file.
 * They are used during postprocess() to locate ESLint messages and map them back to
 * the corresponding TagBlock for translation to original EJS source positions.
 */
type VirtualBlockSegment = {
  block: TagBlock;
  /** 1-based start line of this block inside the combined virtual file. */
  startLine: number;
  /** 1-based end line of this block inside the combined virtual file. */
  endLine: number;
  /** 0-based start offset of this block inside the combined virtual file. */
  startOffset: number;
  /** 0-based end offset (exclusive) of this block inside the combined virtual file. */
  endOffset: number;
};

/**
 * The template of each file, from preprocess() to postprocess(), which frees its trees, the ones of the code of its
 * tags (the `javascriptPartialNode`s of the blocks) included.
 */
const processedFilesMap = new Map<
  string,
  {
    sourceText: string;
    template: EjsTemplate;
    diagnostics: EjsDiagnostic[];
  }
>();

type FileBlocks = {
  segments: VirtualBlockSegment[];
  nonDirectiveSegments: VirtualBlockSegment[];
};

/**
 * File-level mapping from ESLint virtual code to position metadata.
 *
 * Stores two VirtualBlockSegment arrays for each file:
 * - segments: Block positions in the virtual code
 * - nonDirectiveSegments: The segments excluding directive-comment blocks
 *
 * Lifecycle: set in preprocess(), deleted in postprocess().
 */
const fileBlocksMap = new Map<string, FileBlocks>();

export const getFileBlocks = (filename: string): FileBlocks | undefined => {
  return fileBlocksMap.get(filename);
};

/**
 * Cached formatting state for tags to detect if they already match format rules.
 */
type TagFormatState = {
  isFormattedDefault: boolean;
  isFormattedMultilineClose: boolean;
};

/**
 * Unified metadata for a single virtual code block.
 *
 * Combines all per-tag metadata needed by ESLint rules:
 * - tagFormat: array of TagFormatState objects for format rule detection
 */
type VirtualCodeMetadata = {
  tagFormat: TagFormatState[];
  /** Index i is true when i-th non-directive slurp-multiline block needs content normalization. */
  needsNormalize: boolean[];
  /** The diagnostics of the template, `validateTemplate()` of ejs-template-parser, in its coordinates. */
  diagnostics: EjsDiagnostic[];
};

/**
 * The rules reporting diagnostics of the template, with the code of their diagnostic. Their diagnostics are in the
 * coordinates of the template, a stray close delimiter in a text the virtual JavaScript does not have: such a rule
 * requests them with one message at the end of the virtual file, and postprocess() answers the request with them, in
 * the template, with the severity and the `suppressions` of the request.
 */
export const DIAGNOSTIC_RULES = {
  'ejs-templates/no-stray-close-delimiter': 'stray-close-delimiter',
  'ejs-templates/no-comment-across-tags': 'comment-across-tags',
} as const satisfies Record<string, EjsDiagnosticCode>;

type DiagnosticRuleId = keyof typeof DIAGNOSTIC_RULES;

const isDiagnosticRuleId = (ruleId: string | null): ruleId is DiagnosticRuleId =>
  ruleId !== null && Object.hasOwn(DIAGNOSTIC_RULES, ruleId);

/**
 * Request the diagnostics of the code of a rule of `DIAGNOSTIC_RULES`, when the template has one: one message at the
 * end of the virtual file, after every directive comment of the template, which postprocess() answers.
 */
export function requestDiagnostics(context: Rule.RuleContext, ruleId: DiagnosticRuleId, messageId: string): void {
  const { sourceCode } = context;
  const code = DIAGNOSTIC_RULES[ruleId];
  if (!getVirtualCodeMetadata(sourceCode.text)?.diagnostics.some((diagnostic) => diagnostic.code === code)) return;
  const { lines } = sourceCode;
  context.report({ loc: { line: lines.length, column: lines[lines.length - 1].length }, messageId });
}

/**
 * Unified per-virtual-code metadata tracking.
 *
 * Consolidates three metadata arrays for each wrapped virtual code:
 *   (if/while/for/try/etc). Used by prefer-single-line-tags rule.
 *   a single line after trim(). Used by prefer-single-line-tags rule.
 * - **tagFormat**: Index i contains TagFormatState for i-th non-directive block,
 *   tracking which format rules the tag already satisfies. Used by format rule.
 *
 * Lifecycle: set in preprocess(), deleted in postprocess().
 */
const virtualCodeMetadataMap = new Map<string, VirtualCodeMetadata>();

/**
 * The blocks of the tags with a diagnostic of a code of ejs-template-parser, each one with the marker comment its
 * virtual code starts with: the conventions the parser shares with the plugin (`conventionsOf()` of its diagnostics),
 * which a rule reports on the marker of the block, with its sentinel fix. None in a pass without the metadata of the
 * template, the raw one. The directive blocks are left out: the `eslint-enable` an `eslint-disable-next-line`
 * synthesizes carries the position of the tag after it.
 */
export function getDiagnosticBlocks(
  context: Rule.RuleContext,
  code: EjsDiagnosticCode,
): { block: TagBlock; comment: VirtualMarkerComment }[] {
  const diagnostics = getVirtualCodeMetadata(context.sourceCode.text)?.diagnostics ?? [];
  const offsets = new Set(diagnostics.filter((diagnostic) => diagnostic.code === code).map(({ offset }) => offset));
  if (offsets.size === 0) return [];
  return (getFileBlocks(context.filename)?.segments ?? [])
    .filter(({ block }) => block.tagType !== 'directive-comment' && offsets.has(block.tagOffset))
    .map(({ block, startLine, startOffset }) => {
      const [marker] = block.virtualCode.split('\n', 1);
      return {
        block,
        comment: {
          type: 'Line',
          value: marker.slice(2),
          range: [startOffset, startOffset + marker.length],
          loc: { start: { line: startLine, column: 0 }, end: { line: startLine, column: marker.length } },
        },
      };
    });
}

/**
 * Retrieve unified metadata for a virtual code block.
 *
 * Returns all metadata needed by rules: structural control flow, single-line-trim detection,
 * and cached formatting state. Returns undefined if metadata not found (file not preprocessed).
 */
export function getVirtualCodeMetadata(virtualCode: string): VirtualCodeMetadata | undefined {
  return virtualCodeMetadataMap.get(virtualCode);
}

/**
 * Log virtual code structure when ESLint reports fatal parsing errors.
 *
 * Useful for debugging why EJS-to-JavaScript transformation produced invalid code.
 * Renders the actual virtual code that was sent to ESLint along with error details.
 * Output is sent to the debug logger (scope: `ejs-templates:processor`).
 */
function logVirtualCodeOnFatal(
  filename: string,
  virtualMessages: Linter.LintMessage[],
  segments: VirtualBlockSegment[],
): void {
  const fatalMessages = virtualMessages.filter((msg) => msg.fatal);
  if (fatalMessages.length === 0) return;

  const renderedErrors = fatalMessages
    .map((msg) => `- line ${String(msg.line)}, col ${String(msg.column)}: ${msg.message}`)
    .join('\n');
  const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${segments.map((s) => s.block.virtualCode).join('\n')}${GLOBAL_VIRTUAL_CLOSE}`;
  debug(
    `[ejs-templates] ESLint fatal error while processing ${filename}:\n${renderedErrors}\nVirtual code:\n${virtualCode}`,
  );
}

/**
 * Where what EJS drops after an offset of a template ends, in the text there: at the next character it renders
 * (after the blanks a `_%>` slurps and the line break a `-%>` or a `_%>` drops), never past another close delimiter.
 */
function droppedEnd(sourceText: string, texts: EjsText[], offset: number): number {
  const text = texts.find((t) => t.offset <= offset && offset < t.offset + t.length);
  if (!text) return offset;
  const nextRendered = text.renderedOffsets.find((renderedOffset) => renderedOffset >= offset) ?? offset;
  const nextDelimiter = /[-_]?%>/g;
  nextDelimiter.lastIndex = offset;
  return Math.min(nextRendered, nextDelimiter.exec(sourceText)?.index ?? nextRendered, text.offset + text.length);
}

/**
 * The fix of edits of the template, the rest of it rendering as before (`editTemplate()` of the parser, on the template
 * built already): one replacement, of the edits and of what is written again around them, without what is left as it
 * was. Null when they cannot be applied (`editTemplate()` throws a RangeError).
 */
function editFix(template: EjsTemplate, edits: EjsEdit[]): Rule.Fix | null {
  let edited: string;
  try {
    edited = editTemplate(template, edits).template;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  const source = template.text;
  // The edits, with what is written again around them but not what is left as it was. Never short of an edit: a
  // deletion followed by the characters it starts with would otherwise move onto them.
  const first = Math.min(...edits.map(({ offset }) => offset));
  const last = Math.max(...edits.map(({ offset, length }) => offset + length));
  let start = 0;
  while (start < first && source[start] === edited[start]) start++;
  let end = source.length;
  let editedEnd = edited.length;
  while (end > last && editedEnd > start && source[end - 1] === edited[editedEnd - 1]) {
    end--;
    editedEnd--;
  }
  // Then, inside the edits, what they leave as it was.
  while (start < end && start < editedEnd && source[start] === edited[start]) start++;
  while (end > start && editedEnd > start && source[end - 1] === edited[editedEnd - 1]) {
    end--;
    editedEnd--;
  }
  return { range: [start, end], text: edited.slice(start, editedEnd) };
}

/** The fix removing a tag, with what EJS drops after it, the rest of the template rendering as before. */
function removeTag(block: TagBlock, template: EjsTemplate): Rule.Fix | null {
  return editFix(template, [{ offset: block.tagOffset, length: block.tagLength }]);
}

/**
 * The suggestions of a stray close delimiter, deleted with what EJS drops along with it, the output unchanged, or
 * written literally, the output then has what is deleted (see `editFix()`).
 */
function strayCloseDelimiterSuggestions(diagnostic: EjsDiagnostic, template: EjsTemplate): Linter.LintSuggestion[] {
  const { offset, length } = diagnostic;
  const texts = template.nodes.filter((node) => node.kind === 'text');
  const deletedEnd = droppedEnd(template.text, texts, offset + length);
  const suggestions: Linter.LintSuggestion[] = [];
  const literal = editFix(template, [
    { offset, length: deletedEnd - offset, text: [template.text.slice(offset, deletedEnd)] },
  ]);
  if (literal) suggestions.push({ desc: 'Write it literally, the output then has it', fix: literal });
  const deleted = editFix(template, [{ offset, length: deletedEnd - offset }]);
  if (deleted) suggestions.push({ desc: 'Delete it, the output unchanged', fix: deleted });
  return suggestions;
}

/**
 * Answer the requests of the rules reporting diagnostics of the template (see `DIAGNOSTIC_RULES`): one message by
 * diagnostic of the code of the rule, in the template, with the severity and the `suppressions` of the request, which
 * ESLint passes to postprocess() suppressed by a directive comment.
 */
/** The range of a diagnostic of ejs-template-parser in an ESLint message: 1-based columns, a tag spanning lines. */
function rangeOf(
  diagnostic: Pick<EjsDiagnostic, 'offset' | 'length' | 'line' | 'column'>,
  sourceText: string,
): { line: number; column: number; endLine: number; endColumn: number } {
  const lines = sourceText.slice(diagnostic.offset, diagnostic.offset + diagnostic.length).split('\n');
  const lastLine = lines[lines.length - 1];
  return {
    line: diagnostic.line,
    column: diagnostic.column + 1,
    endLine: diagnostic.line + lines.length - 1,
    endColumn: (lines.length === 1 ? diagnostic.column + 1 : 1) + lastLine.length,
  };
}

function answerDiagnosticRequests(
  requests: (Linter.LintMessage | Linter.SuppressedLintMessage)[],
  diagnostics: EjsDiagnostic[],
  template: EjsTemplate,
): Linter.LintMessage[] {
  const sourceText = template.text;
  return requests.flatMap((request) => {
    const { ruleId, severity } = request;
    if (!isDiagnosticRuleId(ruleId)) return [];
    const code = DIAGNOSTIC_RULES[ruleId];
    return diagnostics
      .filter((diagnostic) => diagnostic.code === code)
      .map((diagnostic) => {
        const message: Linter.LintMessage | Linter.SuppressedLintMessage = {
          ...('suppressions' in request && { suppressions: request.suppressions }),
          ruleId,
          severity,
          message: diagnostic.message,
          ...rangeOf(diagnostic, sourceText),
        };
        if (code === 'stray-close-delimiter') {
          message.suggestions = strayCloseDelimiterSuggestions(diagnostic, template);
        }
        return message;
      });
  });
}

/**
 * Extract rule IDs from an ESLint "unused directive" error message.
 *
 * ESLint reports unused `eslint-disable` directives with a message like:
 * "Unused eslint-disable directive (no problems were reported from 'rule-a' and 'rule-b')."
 *
 * This extracts all rule IDs mentioned in the message via regex matching.
 */
function extractUnusedDirectiveRuleIds(message: string): string[] {
  return [...message.matchAll(/'([^']+)'/gu)].map((m) => m[1]);
}

/**
 * Find the matching `eslint-enable` directive for an `eslint-disable` directive listing rules: the next
 * `eslint-enable` without a rule list, which re-enables them all, or with the same rules, in any order.
 *
 * Used for translating fixes that remove or update unused `eslint-disable` directives,
 * so the corresponding `eslint-enable` can be updated or removed together.
 */
function findMatchingEnableDirective(
  blocks: TagBlock[],
  currentBlockIndex: number,
  disableRuleIds: string[],
): { block: TagBlock; index: number } | null {
  // An `eslint-disable-next-line` ends with its synthesized `eslint-enable`, which is no tag of the template.
  if (blocks[currentBlockIndex].nextLineDirective) {
    return null;
  }
  const disabled = new Set(disableRuleIds);
  for (let i = currentBlockIndex + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.isDirectiveComment || block.nextLineDirective) continue;
    const enableMatch = /^eslint-enable(?:\s+(.*))?$/u.exec(block.codeContent);
    if (!enableMatch) continue;
    const [, enableRuleListRaw = ''] = enableMatch;
    const enableRuleIds = new Set(
      enableRuleListRaw
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.length > 0),
    );
    if (
      enableRuleIds.size === 0 ||
      (enableRuleIds.size === disabled.size && [...disabled].every((r) => enableRuleIds.has(r)))
    ) {
      return { block, index: i };
    }
  }
  return null;
}

/**
 * Translate an ESLint "unused directive" error into fixes for both disable and enable directives.
 *
 * When ESLint reports `Unused eslint-disable directive (no problems from 'rule-a')`,
 * this determines:
 * 1. Whether to remove the disable directive entirely or update it to keep only used rules
 * 2. Whether to remove/update a matching enable directive
 *
 * Returns a fix object with:
 * - **disableFix**: removes entire directive or updates rule list; absent when a removal cannot keep what the
 *   template renders (see `removeTag()`), which drops the matching enable fix too
 * - **enableBlock/enableFix**: Optionally returned if a matching enable directive is found
 *
 * A directive removed goes with what EJS drops after its tag, the line break after a `-%>`: left behind, it would
 * render.
 *
 * If no matching enable is found or blocks/blockIndex not provided, returns only disableFix.
 */
function translateUnusedDirectiveFix(
  msg: Linter.LintMessage,
  block: TagBlock,
  template: EjsTemplate,
  blocks?: TagBlock[],
  blockIndex?: number,
): {
  disableFix?: { range: [number, number]; text: string };
  enableBlock?: TagBlock;
  enableFix?: { range: [number, number]; text: string };
} | null {
  if (!block.isDirectiveComment || msg.ruleId !== null || !msg.message.startsWith('Unused eslint-disable directive')) {
    return null;
  }

  const directiveMatch = /^eslint-disable(?:-next-line)?(?:\s+(.*))?$/u.exec(block.codeContent);
  if (!directiveMatch) {
    return null;
  }

  const [, ruleListRaw = ''] = directiveMatch;
  const ruleListText = ruleListRaw.trim();
  if (ruleListText.length === 0) {
    // `eslint-disable` with no explicit rule list: drop the whole directive tag.
    return { disableFix: removeTag(block, template) ?? undefined };
  }

  const currentRuleIds = ruleListText
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  const unusedRuleIds = new Set(extractUnusedDirectiveRuleIds(msg.message));
  if (unusedRuleIds.size === 0) {
    return null;
  }

  const remainingRuleIds = currentRuleIds.filter((ruleId) => !unusedRuleIds.has(ruleId));
  if (remainingRuleIds.length === currentRuleIds.length) {
    return null;
  }

  let disableFix: { range: [number, number]; text: string } | undefined;

  if (remainingRuleIds.length === 0) {
    disableFix = removeTag(block, template) ?? undefined;
  } else {
    disableFix = {
      range: [block.tagOffset, block.tagOffset + block.tagLength],
      text: `<%# ${block.nextLineDirective ? 'eslint-disable-next-line' : 'eslint-disable'} ${remainingRuleIds.join(', ')} ${block.closeDelim}`,
    };
  }

  // Look for matching eslint-enable directive if we have segments info
  const result: {
    disableFix?: { range: [number, number]; text: string };
    enableBlock?: TagBlock;
    enableFix?: { range: [number, number]; text: string };
  } = {
    disableFix,
  };

  if (disableFix && blocks && blockIndex !== undefined) {
    const matchingEnable = findMatchingEnableDirective(blocks, blockIndex, currentRuleIds);
    if (matchingEnable) {
      const enableRuleListMatch = /^eslint-enable(?:\s+(.*))?$/u.exec(matchingEnable.block.codeContent);
      if (enableRuleListMatch) {
        const [, enableRuleListRaw = ''] = enableRuleListMatch;
        const enableRuleListText = enableRuleListRaw.trim();
        if (enableRuleListText.length === 0) {
          // enable has no rule list, no need to update
        } else {
          // Update enable directive to match the remaining rules
          result.enableBlock = matchingEnable.block;
          if (remainingRuleIds.length === 0) {
            const enableFix = removeTag(matchingEnable.block, template);
            // Both removed, or neither: an `eslint-enable` left alone would enable rules nothing disables.
            if (!enableFix) return { enableBlock: undefined };
            result.enableFix = enableFix;
          } else {
            result.enableFix = {
              range: [matchingEnable.block.tagOffset, matchingEnable.block.tagOffset + matchingEnable.block.tagLength],
              text: `<%# eslint-enable ${remainingRuleIds.join(', ')} ${matchingEnable.block.closeDelim}`,
            };
          }
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// ESLint processor
// ---------------------------------------------------------------------------

/**
 * ESLint processor for `.ejs` files.
 *
 * Each non-comment EJS tag is transformed into a virtual JavaScript block and
 * all blocks are concatenated, in source order, into a single incremental
 * virtual file for ESLint.
 *
 * Every per-tag block contains the original tag content (no synthetic
 * per-block braces).  The first line of every per-tag block is a single-line
 * comment (`//@ejs-tag:<type>`) that encodes the tag type so plugin rules can
 * detect EJS-specific patterns.  Global brace balancing (synthetic `}`
 * characters) is appended before the IIFE close when the cumulative net brace
 * delta across all tags is positive, keeping isolated unbalanced fragments
 * parseable while still handling cross-tag constructs like `forEach(x => { … })`
 * correctly.
 *
 * Parsing is backed by tree-sitter-embedded-template for accurate position
 * information and robust syntax handling.
 */
export const processor: Linter.Processor = {
  meta: { name: 'ejs' },

  /**
   * Preprocess: Convert EJS template to virtual JavaScript for ESLint linting.
   *
   * **Processing steps:**
   * 1. Build the template (`buildTemplate()`), its tags and its diagnostics (`validateTemplate()`)
   * 2. Extract each EJS tag as a TagBlock with JS content and metadata
   * 3. Generate virtual JS code for each block (with type marker and optional wrapping)
   * 4. Initialize per-virtual-code metadata maps for rule detection
   * 5. Store block position mappings for later message translation
   *
   * **Return value:** the virtual code, wrapped in a function as EJS compiles a template into the body of one:
   * `(function() {\n <blocks> \n})();`. ESLint lints it once: parsing it and running every rule is most of the
   * time of a lint, so that a second virtual code would nearly double it.
   *
   * **Metadata initialization:**
   * - tagFormatByVirtualCodeMap: tracks format rule satisfaction
   * - fileBlocksMap: stores segments for position-based message translation
   */
  preprocess(text: string, filename: string): (string | { text: string; filename: string })[] {
    // One parse of the template: its tags, its diagnostics; postprocess() frees it.
    const template = buildTemplate(text);
    let blocks: TagBlock[];
    let diagnostics: EjsDiagnostic[];
    try {
      diagnostics = validateTemplate(template);
      blocks = extractTagBlocks(template.tags, diagnostics);
      processedFilesMap.set(filename, {
        sourceText: text,
        template,
        diagnostics,
      });
    } catch (error) {
      processedFilesMap.delete(filename);
      cleanupTemplate(template);
      throw error;
    }

    if (blocks.length === 0) {
      fileBlocksMap.set(filename, { segments: [], nonDirectiveSegments: [] });
      // No rule runs without a virtual file: the wrapper alone, for the rules to request the diagnostics of the
      // template, a stray close delimiter the only one a template without blocks can have.
      const reported = new Set<EjsDiagnosticCode>(Object.values(DIAGNOSTIC_RULES));
      if (!diagnostics.some((diagnostic) => reported.has(diagnostic.code))) {
        return [];
      }
      const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${GLOBAL_VIRTUAL_CLOSE}`;
      virtualCodeMetadataMap.set(virtualCode, { tagFormat: [], needsNormalize: [], diagnostics });
      return [virtualCode];
    }

    // Track block positions in the virtual code, used during postprocess() to locate ESLint messages and translate
    // them back to source.
    const segments: VirtualBlockSegment[] = [];
    let lineCursor = 2; // Start at line 2 (line 1 is GLOBAL_VIRTUAL_OPEN)
    let offsetCursor = GLOBAL_VIRTUAL_OPEN.length; // Account for wrapper in offset

    for (const block of blocks) {
      const lineCount = block.virtualCode.split('\n').length;
      const startLine = lineCursor;
      const endLine = startLine + lineCount - 1;
      const startOffset = offsetCursor;
      const endOffset = startOffset + block.virtualCode.length;

      segments.push({ block, startLine, endLine, startOffset, endOffset });

      // Each block is joined with a single newline in the virtual code.
      lineCursor += lineCount;
      offsetCursor += block.virtualCode.length + 1; // +1 for separator newline
    }

    const nonDirectiveSegments = segments.filter(({ block }) => !block.isDirectiveComment);
    fileBlocksMap.set(filename, { segments, nonDirectiveSegments });

    const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${blocks.map((b) => b.virtualCode).join('\n')}${GLOBAL_VIRTUAL_CLOSE}`;
    const nonDirectiveBlocks = blocks.filter((block) => !block.isDirectiveComment);
    const misindented = new Set(diagnostics.filter(({ code }) => code === 'indent').map(({ offset }) => offset));
    virtualCodeMetadataMap.set(virtualCode, {
      tagFormat: nonDirectiveBlocks.map((block) => {
        const originalText = block.openDelim + block.codeContent + block.closeDelim;
        return {
          isFormattedDefault: originalText === buildFormattedTag(block, { multilineCloseOnNewLine: false }),
          isFormattedMultilineClose: originalText === buildFormattedTag(block, { multilineCloseOnNewLine: true }),
        };
      }),
      needsNormalize: nonDirectiveBlocks.map((block) => {
        // A tag alone on its line: the fix rewrites the line from its start, which holds the
        // text before the tag otherwise. A tag the parser diagnoses as indented otherwise is
        // reported for its indentation, and fixed with its content.
        if (block.tagType !== 'slurp-multiline' || !block.isStandalone || misindented.has(block.tagOffset))
          return false;
        // Only normalize when the close delimiter is already on its own line
        // (last codeContent segment is all whitespace). If the close is on the
        // same line as the last content line, normalizing it would conflict with
        // `format: same-line`, causing a circular fix.
        const lastSegment = block.codeContent.split('\n').pop() ?? '';
        if (lastSegment.trim() !== '') return false;
        const normalizedText = buildIndentedTag(block, { normalizeContent: true });
        const currentText = block.lineIndent + block.openDelim + block.codeContent + block.closeDelim;
        return normalizedText !== currentText;
      }),
      diagnostics,
    });

    return [virtualCode];
  },

  /**
   * Postprocess: Translate ESLint messages from virtual code back to original EJS source.
   *
   * **Processing steps:**
   * 1. Receive the messages of the virtual code
   * 2. Report a syntax error tree-sitter finds in the JavaScript of the template, alone
   * 3. Report the parsing error ESLint's parser finds (a fatal message), at its tag
   * 4. For each message, locate its TagBlock via segment mapping
   * 5. Translate message line/column from virtual to original EJS positions
   * 6. Translate sentinel-based fixes for plugin rules (prefer-single-line-tags, etc)
   * 7. Translate general JS fixes (from rules like prefer-const) via offset mapping
   * 8. Clean up per-virtual-code metadata maps after processing
   * 9. Answer the requests of the rules of `DIAGNOSTIC_RULES` with the diagnostics of the template
   * 10. Free the template, in a `finally`
   */
  postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
    const processedFile = processedFilesMap.get(filename);
    if (!processedFile) {
      throw new Error(`Unexpectedly did not find processed file data for ${filename}`);
    }
    try {
      const sourceText = processedFile.sourceText;
      const { segments = [] } = fileBlocksMap.get(filename) ?? {};
      fileBlocksMap.delete(filename);
      const currentVirtualCode = `${GLOBAL_VIRTUAL_OPEN}${segments.map((s) => s.block.virtualCode).join('\n')}${GLOBAL_VIRTUAL_CLOSE}`;
      virtualCodeMetadataMap.delete(currentVirtualCode);

      const answeredMessages = answerDiagnosticRequests(
        (messages[0] ?? []).filter((msg) => isDiagnosticRuleId(msg.ruleId)),
        processedFile.diagnostics,
        processedFile.template,
      );

      if (segments.length === 0) {
        return answeredMessages;
      }

      // Even in a single incremental virtual file, each tag is still wrapped in
      // its own function block for parseability/fix mapping.  This can trigger
      // false positives for rules that require cross-tag flow/scope.
      const suppressedRuleIds = new Set(['no-undef']);

      const virtualMessages = messages[0] ?? [];
      logVirtualCodeOnFatal(filename, virtualMessages, segments);
      const hasIndentMessages = virtualMessages.some((msg) => msg.ruleId === 'ejs-templates/indent');

      const mappedMessages = virtualMessages
        .filter((msg) => !msg.fatal && !suppressedRuleIds.has(msg.ruleId ?? '') && !isDiagnosticRuleId(msg.ruleId))
        .flatMap((normalizedMsg) => {
          const segmentIndex = segments.findIndex(
            (s) => normalizedMsg.line >= s.startLine && normalizedMsg.line <= s.endLine,
          );
          if (segmentIndex === -1) {
            return [];
          }
          const segment = segments[segmentIndex];

          // The first line of each virtual block is the `//@ejs-tag:<type>` marker comment.
          // It is generated code, not real JS — suppress lint errors from external rules
          // reported on that line. ejs-templates rules and ESLint system messages (ruleId
          // === null, e.g. unused-disable-directives) are intentional and kept intact.
          if (
            normalizedMsg.line === segment.startLine &&
            normalizedMsg.ruleId !== null &&
            !normalizedMsg.ruleId.startsWith('ejs-templates/')
          ) {
            return [];
          }

          // The `;` appended to an output tag's expression is generated too, and unlike the
          // marker it shares a line with real code. A semicolon rule reporting on it is talking
          // about a character the author never wrote — `@stylistic/semi` in `never` mode would
          // otherwise flag every output tag for a semicolon that is not in the template.
          if (isSyntheticSuffixMessage(normalizedMsg, segment)) {
            return [];
          }

          // Convert global (combined-file) positions to per-block positions: the end in the block it is in, a later one
          // for a node across tags, the last one past them (in the wrapper).
          const { endLine } = normalizedMsg;
          const endSegment =
            endLine === undefined
              ? segment
              : (segments.find((s) => endLine >= s.startLine && endLine <= s.endLine) ?? segments[segments.length - 1]);
          const localMsg: Linter.LintMessage = {
            ...normalizedMsg,
            line: normalizedMsg.line - segment.startLine + 1,
            column: normalizedMsg.column,
          };

          if (endLine !== undefined) {
            localMsg.endLine = endLine - endSegment.startLine + 1;
            localMsg.endColumn = normalizedMsg.endColumn;
          }

          if (normalizedMsg.fix) {
            const [start, end] = normalizedMsg.fix.range;
            if (start >= segment.startOffset && end <= segment.endOffset) {
              localMsg.fix = {
                range: [start - segment.startOffset, end - segment.startOffset],
                text: normalizedMsg.fix.text,
              };
            } else {
              delete localMsg.fix;
            }
          }

          const mapped = mapMessage(localMsg, segment.block, sourceText, endSegment.block);

          if (mapped.fix) {
            const blocks = segments.map((s) => s.block);
            const unusedDirectiveFixResult = translateUnusedDirectiveFix(
              mapped,
              segment.block,
              processedFile.template,
              blocks,
              segmentIndex,
            );
            if (unusedDirectiveFixResult) {
              const result: Linter.LintMessage[] = [];
              const { disableFix } = unusedDirectiveFixResult;
              if (disableFix) {
                result.push({ ...mapped, fix: disableFix });
              } else {
                // No removal keeps what the template renders: the directive is reported, not fixed.
                const unfixed = { ...mapped };
                delete unfixed.fix;
                result.push(unfixed);
              }
              // Handle enable directive fix in a separate message(s)
              if (unusedDirectiveFixResult.enableBlock && unusedDirectiveFixResult.enableFix) {
                // Find the virtual block range for the enable directive to calculate correct position
                const enableBlockIndex = blocks.indexOf(unusedDirectiveFixResult.enableBlock);
                if (enableBlockIndex !== -1) {
                  const enableSegment = segments[enableBlockIndex];
                  const enableMappedMsg = mapMessage(
                    {
                      ruleId: null,
                      message: 'Unused eslint-disable directive',
                      severity: 2,
                      line: enableSegment.startLine + 1,
                      column: 1,
                    },
                    unusedDirectiveFixResult.enableBlock,
                    sourceText,
                  );
                  result.push({ ...enableMappedMsg, fix: unusedDirectiveFixResult.enableFix });
                }
              }
              return result;
            }

            const translated = translateFix(mapped.fix, segment.block, {
              applyIndentForSingleLineTags: hasIndentMessages,
              template: processedFile.template,
              diagnostics: processedFile.diagnostics,
            });
            if (translated) {
              return [{ ...mapped, fix: translated }];
            }

            // No translation available – drop the fix.
            const result = { ...mapped };
            delete result.fix;
            return [result];
          }

          // Supply the fix core ESLint cannot produce itself. The report is already correct;
          // only the edit is missing, so it is attached to the core rule's own message rather
          // than duplicated into a plugin rule.
          if (mapped.ruleId === CORE_NO_NEGATED_CONDITION) {
            const negatedConditionFix = buildNegatedConditionFix(
              segment.block,
              processedFile.template,
              sourceText,
              offsetOfPosition(sourceText, mapped.line, mapped.column),
            );
            if (negatedConditionFix) {
              return [{ ...mapped, fix: negatedConditionFix }];
            }
          }

          return [mapped];
        });

      // The virtual JavaScript does not parse: the errors ejs-template-parser tells of the JavaScript of the template, at
      // their tags (a block no tag closes, a tag closing a block none opens, code not parsing); otherwise the parsing
      // error of ESLint's parser (an early error, such as a declaration repeated), at its tag, or past the code of the
      // last tag (in the wrapper), at its end.
      const javascriptErrors = virtualMessages.some((msg) => msg.fatal)
        ? processedFile.diagnostics.filter((diagnostic) => JAVASCRIPT_ERRORS.has(diagnostic.code))
        : [];
      const fatalMessages: Linter.LintMessage[] = javascriptErrors.length
        ? javascriptErrors.map((diagnostic) => ({
            ruleId: null,
            fatal: true,
            severity: 2,
            message: `Parsing error: ${diagnostic.message}`,
            ...rangeOf(diagnostic, sourceText),
          }))
        : virtualMessages
            .filter((msg) => msg.fatal)
            .map((msg) => {
              const segment = segments.find((s) => msg.line >= s.startLine && msg.line <= s.endLine);
              if (!segment) {
                const { block } = segments[segments.length - 1];
                let line = block.originalLine;
                let column = block.originalColumn + 1;
                for (const ch of block.codeContent) {
                  if (ch === '\n') {
                    line += 1;
                    column = 1;
                  } else {
                    column += 1;
                  }
                }
                const fatalMsg: Linter.LintMessage = { ...msg, line, column };
                delete fatalMsg.fix;
                return fatalMsg;
              }
              const localMsg: Linter.LintMessage = {
                ...msg,
                line: msg.line - segment.startLine + 1,
                column: msg.column,
              };
              if (msg.endLine !== undefined) {
                localMsg.endLine = msg.endLine - segment.startLine + 1;
                localMsg.endColumn = msg.endColumn;
              }
              delete localMsg.fix;
              return mapMessage(localMsg, segment.block, sourceText);
            });

      const formatMessages = mappedMessages.filter((msg) => msg.ruleId === 'ejs-templates/format');
      const nonFormatMessages = mappedMessages.filter((msg) => msg.ruleId !== 'ejs-templates/format');

      // Keep `format` fixes last so all structural/semantic fixes and validations
      // run first, and formatting is applied as a final normalization step.
      return [...nonFormatMessages, ...fatalMessages, ...answeredMessages, ...formatMessages];
    } finally {
      // On every path: the trees of the template, the ones of the code of its tags included.
      processedFilesMap.delete(filename);
      cleanupTemplate(processedFile.template);
    }
  },

  supportsAutofix: true,
};
